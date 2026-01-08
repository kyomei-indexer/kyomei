#!/bin/bash
# Initialize S3 buckets for backup storage

awslocal s3 mb s3://kyomei-backups

echo "LocalStack S3 initialized - bucket 'kyomei-backups' created"
