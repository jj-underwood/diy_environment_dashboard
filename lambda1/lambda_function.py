import boto3
import json
import logging
import os
import random
import string
from datetime import datetime, timedelta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['DYNAMODB_TABLE'])
ses = boto3.client('ses')
ses_source = os.environ['SES_EMAIL']
allow_origin = os.environ['ALLOW_ORIGIN']

def generate_code(length=6):
    return ''.join(random.choices(string.digits, k=length))

def lambda_handler(event, context):
    email = json.loads(event['body'])['email']
    code = generate_code()
    expiration_time = datetime.utcnow() + timedelta(minutes=10)
    logger.info(f"Code: {code}")

    # Store the code in DynamoDB
    table.put_item(
        Item={
            'email': email,
            'code': code,
            'expiration': expiration_time.isoformat()
        }
    )

    # Send the code via SES
    ses.send_email(
        Source=ses_source,
        Destination={'ToAddresses': [email]},
        Message={
            'Subject': {'Data': 'Your One-Time Code'},
            'Body': {'Text': {'Data': f'Your one-time code is {code}'}}
        }
    )

    return {
        'statusCode': 200,
        'headers': {
                'Access-Control-Allow-Origin': allow_origin,
                'Access-Control-Allow-Methods': 'OPTIONS, GET, POST',
                'Access-Control-Allow-Headers': 'Content-Type'
        },
        'body': json.dumps('Code sent successfully')
    }


