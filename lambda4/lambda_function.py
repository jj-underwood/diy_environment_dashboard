import boto3
import json
import logging
import os
from datetime import datetime, timedelta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

allow_origin = os.environ['ALLOW_ORIGIN']
timestream_database = os.environ['TIMESTREAM_DATABASE']
timestream_table = os.environ['TIMESTREAM_TABLE']

cache = {}
cache_order = []
CACHE_LIMIT = 10
CACHE_EXPIRATION = timedelta(hours=1)

def lambda_handler(event, context):
    devices = event['queryStringParameters'].get('devices').split(',')
    metrics = event['queryStringParameters'].get('metrics').split(',')
    start_time = event['queryStringParameters'].get('start_time')
    end_time = event['queryStringParameters'].get('end_time')
    
    try:
        start_dt = datetime.strptime(start_time, '%Y-%m-%dT%H:%M')
        startTime = start_dt.strftime('%Y-%m-%d %H:%M:%S')
        end_dt = datetime.strptime(end_time, '%Y-%m-%dT%H:%M')
        endTime = end_dt.strftime('%Y-%m-%d %H:%M:%S')
    except ValueError as e:
        logger.error(f"Timestamp formatting error: {str(e)}")
        return {
            'statusCode': 400,
            'headers': {
                'Access-Control-Allow-Origin': allow_origin,
                'Access-Control-Allow-Methods': 'OPTIONS, GET',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            'body': json.dumps({'error': 'Invalid timestamp format'})
        }
    
    cache_key = f"{'_'.join([m.replace('_', '-') for m in metrics])}_{'_'.join([d.replace('_', '-') for d in devices])}_{start_time}_{end_time}"
    logger.info(f"Cache Key: {cache_key}")
    current_time = datetime.utcnow()
    if cache_key in cache:
        entry = cache[cache_key]
        if current_time - entry['timestamp'] < CACHE_EXPIRATION:
            logger.info(f"Cache Hit: {entry['data']}")
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Origin': allow_origin,
                    'Access-Control-Allow-Methods': 'OPTIONS, GET',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
                },
                'body': json.dumps(entry['data'])
            }
        else:
            logger.info(f"Cache Expired")
            del cache[cache_key]
            cache_order.remove(cache_key)
    
    aggregation_interval = calculate_aggregation_interval(start_dt, end_dt)
    logger.info(f"Aggregation Interval: {aggregation_interval}")
    
    query_metrics = []
    for metric in metrics:
        if metric in ['temperature', 'humidity', 'illuminance', 'pm1_0', 'pm2_5', 'pm4_0', 'pm10_0', 'pm2_5_avg_24h', 'pm10_0_avg_24h', 'pressure', 'uv']:
            query_metrics.append("MAX(CASE WHEN measure_name = '{}' THEN measure_value::double END) AS {}".format(metric, metric))
        elif metric in ['co2', 'voc', 'nox']:
            query_metrics.append("MAX(CASE WHEN measure_name = '{}' THEN measure_value::bigint END) AS {}".format(metric, metric))
        elif metric in ['presence']:
            query_metrics.append("MAX(CASE WHEN measure_name = '{}' THEN measure_value::varchar END) AS {}".format(metric, metric))
    
    if aggregation_interval:
        query = f"""
            SELECT
                BIN(time, {aggregation_interval}) AS binned_time,
                DEVICE_NAME,
                {', '.join(query_metrics)}
            FROM "{timestream_database}"."{timestream_table}"
            WHERE
                DEVICE_NAME IN ({', '.join([f"'{d}'" for d in devices])})
                AND measure_name IN ({', '.join([f"'{m}'" for m in metrics])})
                AND time BETWEEN '{startTime}' AND '{endTime}'
            GROUP BY BIN(time, {aggregation_interval}), DEVICE_NAME
            ORDER BY binned_time
        """
    else:
        query = f"""
            SELECT
                time,
                DEVICE_NAME,
                {', '.join(query_metrics)}
            FROM "{timestream_database}"."{timestream_table}"
            WHERE
                DEVICE_NAME IN ({', '.join([f"'{d}'" for d in devices])})
                AND measure_name IN ({', '.join([f"'{m}'" for m in metrics])})
                AND time BETWEEN '{startTime}' AND '{endTime}'
            GROUP BY time, DEVICE_NAME
            ORDER BY time
        """
    
    logger.info(f"Query: {query}")
    client = boto3.client('timestream-query')
    
    try:
        response = client.query(QueryString=query)
        rows = response['Rows']
        next_token = response.get('NextToken')
        while next_token:
            response = client.query(QueryString=query, NextToken=next_token)
            rows.extend(response['Rows'])
            next_token = response.get('NextToken')
        logger.info(f"Query successful: {len(rows)} rows retrieved.")
        processedData = process_data(rows, metrics)
        if len(cache_order) >= CACHE_LIMIT:
            oldest_key = cache_order.pop(0)
            del cache[oldest_key]
            logger.info(f"Cache Pop: {oldest_key}")
        logger.info(f"Cache Push: {current_time}")
        cache[cache_key] = {'data': processedData, 'timestamp': current_time}
        cache_order.append(cache_key)
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': allow_origin,
                'Access-Control-Allow-Methods': 'OPTIONS, GET',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            'body': json.dumps(processedData)
        }
    except client.exceptions.ValidationException as e:
        logger.error(f"Validation error: {str(e)}")
        return {
            'statusCode': 400,
            'headers': {
                'Access-Control-Allow-Origin': allow_origin,
                'Access-Control-Allow-Methods': 'OPTIONS, GET',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            'body': json.dumps({'error': str(e)})
        }
    except Exception as e:
        logger.error(f"Query failed: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Access-Control-Allow-Origin': allow_origin,
                'Access-Control-Allow-Methods': 'OPTIONS, GET',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            'body': json.dumps({'error': str(e)})
        }

def calculate_aggregation_interval(start_time, end_time):
    delta = end_time - start_time
    if delta.total_seconds() <= 86400:
        return None
    else:
        ratio = delta.total_seconds() / 86400
        return '{}s'.format(round(300 * ratio))

def process_data(rows, metrics):
    filtered_rows = []
    for row in rows:
        row_data = row['Data']
        filtered_row = {
            'time': row_data[0]['ScalarValue'],
            'device': row_data[1]['ScalarValue']
            #'metrics': {}
        }
        for i, metric in enumerate(metrics):
            value = row_data[i + 2].get('ScalarValue')
            if value is not None:
                if metric == 'presence':
                    filtered_row[metric] = value.strip('"')
                else:
                    try:
                        filtered_row[metric] = float(value) if '.' in value else int(value)
                    except ValueError:
                        filtered_row[metric] = None
        filtered_rows.append(filtered_row)
    ret = {'data': filtered_rows, 'daily_stats': None, 'longterm_stats': None}
    return ret
