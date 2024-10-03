import boto3
import json
import jwt
import logging
import os
from datetime import datetime, timedelta

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['DYNAMODB_TABLE'])
secret_key = os.environ['JWT_SECRET_KEY']
allow_origin = os.environ['ALLOW_ORIGIN']

def lambda_handler(event, context):
    email = event['email']
    code = event['code']
    
    response = table.get_item(Key={'email': email})
    if 'Item' not in response:
        return {
            'statusCode': 400,
            'headers': {
                'Access-Control-Allow-Origin': allow_origin,
                'Access-Control-Allow-Methods': 'OPTIONS, GET, POST',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps('Invalid email')
        }
    
    item = response['Item']
    if code != item['code']:
        return {
            "statusCode": 400,'headers': {
                'Access-Control-Allow-Origin': allow_origin,
                'Access-Control-Allow-Methods': 'OPTIONS, GET, POST',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps('Invalid code')
        }
    
    if datetime.fromisoformat(item['expiration']) < datetime.utcnow():
        return {
            'statusCode': 400,
            'headers': {
                'Access-Control-Allow-Origin': allow_origin,
                'Access-Control-Allow-Methods': 'OPTIONS, GET, POST',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps('Code expired')
        }
    
    token = generate_jwt_token(item['email'])
    logger.info(f"Token: {token}")
    return {
        'statusCode': 200,
        'headers': {
                'Access-Control-Allow-Origin': allow_origin,
                'Access-Control-Allow-Methods': 'OPTIONS, GET, POST',
                'Access-Control-Allow-Headers': 'Content-Type'
        },
        'body':
            {'token': token}
    }

def generate_jwt_token(email):
    payload = {
        'sub': email,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(minutes=30)
    }
    token = jwt.encode(payload, secret_key, algorithm='HS256')
    return token
