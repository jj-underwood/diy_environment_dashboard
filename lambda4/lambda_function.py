import boto3
from boto3.dynamodb.conditions import Key, Attr
from collections import defaultdict
from decimal import Decimal
import json
import logging
import os
from datetime import datetime, timedelta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

cache = {}
cache_order = []
CACHE_LIMIT = 10
CACHE_EXPIRATION = timedelta(hours=1)

dynamodb = boto3.resource('dynamodb')
dynamodb_table = dynamodb.Table(os.environ['DYNAMODB_TABLE'])
dynamodb_ttl = os.environ['DYNAMODB_TTL']

timestream_database = os.environ['TIMESTREAM_DATABASE']
timestream_table = os.environ['TIMESTREAM_TABLE']

allow_origin = os.environ['ALLOW_ORIGIN']
response_headers = {
    'Access-Control-Allow-Origin': allow_origin,
    'Access-Control-Allow-Methods': 'OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}

def lambda_handler(event, context):
    if 'queryStringParameters' not in event or not event['queryStringParameters']:
        return {
            'statusCode': 400,
            'headers': response_headers,
            'body': json.dumps({'error': 'No query parameters'})
        }
    
    if 'devices' not in event['queryStringParameters'] or 'metrics' not in event['queryStringParameters']:
        return {
            'statusCode': 400,
            'headers': response_headers,
            'body': json.dumps({'error': 'Invalid parameters'})
        }
        
    devices = event['queryStringParameters'].get('devices').split(',')
    metrics = event['queryStringParameters'].get('metrics').split(',')
    
    current_time = datetime.utcnow()
    start_time = event['queryStringParameters'].get('start_time')
    end_time = event['queryStringParameters'].get('end_time')
    if not start_time:
        logger.info('start_time is not set')
        start_time = current_time - timedelta(days=1)
        start_time = start_time.strftime('%Y-%m-%dT%H:%M')
    if not end_time:
        logger.info('end_time is not set')
        end_time = current_time.strftime('%Y-%m-%dT%H:%M')
    
    try:
        start_dt = datetime.strptime(start_time, '%Y-%m-%dT%H:%M')
        end_dt = datetime.strptime(end_time, '%Y-%m-%dT%H:%M')
    except ValueError as e:
        logger.error(f"Timestamp formatting error: {str(e)}")
        return {
            'statusCode': 400,
            'headers': response_headers,
            'body': json.dumps({'error': 'Invalid timestamp format'})
        }
    
    logger.info(f"start_dt: {start_dt}, end_dt: {end_dt}")
    
    cache_key = f"{'_'.join([m.replace('_', '-') for m in metrics])}_{'_'.join([d.replace('_', '-') for d in devices])}_{start_time}_{end_time}"
    response_code, response_data = retrieve_from_cache(cache_key, current_time)
    if response_code:
        return {
            'statusCode': response_code,
            'headers': response_headers,
            'body': json.dumps(response_data)
        }
    
    aggregation_interval = calculate_aggregation_interval(start_dt, end_dt)
    logger.info(f"Aggregation Interval: {aggregation_interval}")
    
    if (current_time - start_dt) < timedelta(seconds=int(dynamodb_ttl)):
        response_code, response_data = retrieve_from_dynamodb(metrics, devices, start_dt, end_dt, aggregation_interval)
    else:
        response_code, response_data = retrieve_from_timestream(metrics, devices, start_dt, end_dt, aggregation_interval)
    
    store_to_cache(cache_key, current_time, response_data)
    
    return {
        'statusCode': response_code,
        'headers': response_headers,
        'body': json.dumps(response_data)
    }

def retrieve_from_cache(cache_key, current_time):
    logger.info(f"Cache Key: {cache_key}")
    if cache_key in cache:
        entry = cache[cache_key]
        if current_time - entry['timestamp'] < CACHE_EXPIRATION:
            logger.info(f"Cache Hit: {len(entry['data']['data'])} rows")
            return 200, entry['data']
        else:
            logger.info(f"Cache Expired")
            del cache[cache_key]
            cache_order.remove(cache_key)
    return None, None

def store_to_cache(cache_key, current_time, cache_data):
    if len(cache_order) >= CACHE_LIMIT:
        oldest_key = cache_order.pop(0)
        del cache[oldest_key]
        logger.info(f"Cache Pop: {oldest_key}")
    logger.info(f"Cache Push: {current_time}")
    cache[cache_key] = {'data': cache_data, 'timestamp': current_time}
    cache_order.append(cache_key)

def calculate_aggregation_interval(start_time, end_time):
    delta = end_time - start_time
    if delta.total_seconds() <= 86400:
        return None
    else:
        ratio = delta.total_seconds() / 86400
        return round(300 * ratio)

def retrieve_from_dynamodb(metrics, devices, start_dt, end_dt, aggregation_interval):
    logger.info(f"Retrieve data from DynamoDB, start_dt: {start_dt}, end_dt: {end_dt}")
    results = []
    current_dt = start_dt
    while current_dt <= end_dt:
        date_str = current_dt.strftime('%Y-%m-%d')
        start_time = start_dt.strftime('%H:%M:%S') if current_dt.date() == start_dt.date() else '00:00:00'
        end_time = end_dt.strftime('%H:%M:%S') if current_dt.date() == end_dt.date() else '23:59:59'
        last_evaluated_key = None
        while True:
            query_params = {
                'KeyConditionExpression': Key('pk').eq(date_str) & Key('sk').between(start_time, end_time)
            }
            if last_evaluated_key:
                query_params['ExclusiveStartKey'] = last_evaluated_key
            try:
                response = dynamodb_table.query(**query_params)
                items = response.get('Items', [])
            except Exception as e:
                logger.error(f"Query failed: {str(e)}")
                return 500, {'error': str(e)}
            filtered_items = filter_data(items, devices, metrics)
            results.extend(filtered_items)
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
        current_dt += timedelta(days=1)
    results.sort(key=lambda x: (x['time'], x['device']))
    logger.info(f"Query successful: {len(results)} rows retrieved.")
    ret = process_data_from_dynamodb(results, metrics, start_dt, aggregation_interval)
    return 200, ret

def filter_data(items, device_names, metrics):
    filtered_items = []
    for item in items:
        sk_time, sk_device = item['sk'].split('#')
        if sk_device in device_names:
            filtered_item = {k: convert_type(k, v) for k, v in item['payload'].items() if k in metrics}
            filtered_item['time'] = ' '.join([item['pk'], sk_time])
            filtered_item['device'] = sk_device
            filtered_items.append(filtered_item)
    return filtered_items

def convert_type(metrics, value):
    if metrics in ['temperature', 'humidity', 'illuminance', 'pm1_0', 'pm2_5', 'pm4_0', 'pm10_0', 'pm2_5_avg_24h', 'pm10_0_avg_24h', 'pressure', 'uv']:
        return float(value)
    elif metrics in ['co2', 'voc', 'nox']:
        return int(value)
    elif metrics in ['presence']:
        return str(value)
    else:
        return value

def process_data_from_dynamodb(rows, metrics, start_dt, aggregation_interval):
    if not aggregation_interval:
        ret = {'data': rows, 'daily_stats': None, 'longterm_stats': None}
        return ret
    
    binned_data = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for item in rows:
        item_time = datetime.strptime(item['time'], '%Y-%m-%d %H:%M:%S')
        time_bin = (item_time - start_dt).total_seconds() // aggregation_interval
        binned_time = start_dt + timedelta(seconds=time_bin * aggregation_interval)
        device = item['device']
        for metric in metrics:
            if metric in item:
                binned_data[device][binned_time][metric].append(item[metric])
    aggregated_data = []
    for device, time_bins in binned_data.items():
        for binned_time, metrics_data in time_bins.items():
            aggregated_record = {
                'time': binned_time.strftime('%Y-%m-%d %H:%M:%S'),
                'device': device
            }
            for metric, values in metrics_data.items():
                if metric == 'presence':
                    if 'on' in values:
                        aggregated_record[metric] = 'on'
                    else:
                        aggregated_record[metric] = 'off'
                else:
                    aggregated_record[metric] = max(values)
            aggregated_data.append(aggregated_record)
    aggregated_data.sort(key=lambda x: (x['time'], x['device']))
    logger.info(f"Aggregated to: {len(aggregated_data)} rows retrieve.")
    ret = {'data': aggregated_data, 'daily_stats': None, 'longterm_stats': None}
    return ret

def retrieve_from_timestream(metrics, devices, start_dt, end_dt, aggregation_interval):
    logger.info(f"Retrieve data from Timestream")
    startTime = start_dt.strftime('%Y-%m-%d %H:%M:%S')
    endTime = end_dt.strftime('%Y-%m-%d %H:%M:%S')
    query_metrics = []
    for metric in metrics:
        if metric in ['temperature', 'humidity', 'illuminance', 'pm1_0', 'pm2_5', 'pm4_0', 'pm10_0', 'pm2_5_avg_24h', 'pm10_0_avg_24h', 'pressure', 'uv']:
            query_metrics.append("MAX(CASE WHEN measure_name = '{}' THEN measure_value::double END) AS {}".format(metric, metric))
        elif metric in ['co2', 'voc', 'nox']:
            query_metrics.append("MAX(CASE WHEN measure_name = '{}' THEN measure_value::bigint END) AS {}".format(metric, metric))
        elif metric in ['presence']:
            query_metrics.append("MAX(CASE WHEN measure_name = '{}' THEN measure_value::varchar END) AS {}".format(metric, metric))
    
    if aggregation_interval:
        aggregation_interval = '{}s'.format(aggregation_interval)
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
        processedData = process_data_from_timestream(rows, metrics)
        return 200, processedData
    except client.exceptions.ValidationException as e:
        logger.error(f"Validation error: {str(e)}")
        return 400, {'error': str(e)}
    except Exception as e:
        logger.error(f"Query failed: {str(e)}")
        return 500, {'error': str(e)}

def process_data_from_timestream(rows, metrics):
    filtered_rows = []
    for row in rows:
        row_data = row['Data']
        filtered_row = {
            'time': row_data[0]['ScalarValue'],
            'device': row_data[1]['ScalarValue']
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
