#!/usr/bin/env node

import * as AWS from 'aws-sdk';
import { program } from 'commander';
import * as fs from 'fs';
import * as glob from 'glob';
import * as path from 'path';

// Configure CLI options
program
  .name('upload-to-s3')
  .description('Upload performance results and dashboard to S3')
  .version('1.0.0');

program
  .requiredOption('-b, --bucket <name>', 'S3 bucket name')
  .option('-p, --prefix <prefix>', 'S3 key prefix', 'performance')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .option('-d, --directory <directory>', 'Directory containing results', 'performance-results')
  .option('--public', 'Make files publicly accessible', false);

program.parse();

const options = program.opts();

async function uploadFilesToS3() {
  console.log('Configuring AWS S3 client...');
  const s3 = new AWS.S3({ region: options.region });
  
  // Directory containing files to upload
  const directory = path.resolve(options.directory);
  if (!fs.existsSync(directory)) {
    console.error(`Error: Directory ${directory} does not exist`);
    process.exit(1);
  }
  
  // Find all files
  const files = glob.sync(path.join(directory, '**/*.*'));
  if (files.length === 0) {
    console.warn(`Warning: No files found in ${directory}`);
    return;
  }
  
  console.log(`Found ${files.length} files to upload`);
  
  // Upload each file
  for (const file of files) {
    const relativePath = path.relative(directory, file);
    const key = path.join(options.prefix, relativePath).replace(/\\/g, '/');
    
    // Determine content type
    let contentType = 'application/octet-stream';
    if (file.endsWith('.json')) {
      contentType = 'application/json';
    } else if (file.endsWith('.html')) {
      contentType = 'text/html';
    } else if (file.endsWith('.css')) {
      contentType = 'text/css';
    } else if (file.endsWith('.js')) {
      contentType = 'application/javascript';
    }
    
    console.log(`Uploading ${relativePath} to s3://${options.bucket}/${key}`);
    
    const fileContent = fs.readFileSync(file);
    const params: AWS.S3.PutObjectRequest = {
      Bucket: options.bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType,
    };
    
    // Add public access if requested
    if (options.public) {
      params.ACL = 'public-read';
    }
    
    try {
      await s3.putObject(params).promise();
      console.log(`✅ Successfully uploaded ${key}`);
    } catch (error) {
      console.error(`❌ Error uploading ${key}:`, error);
    }
  }
  
  // Generate URLs
  const dashboardUrl = `https://${options.bucket}.s3.amazonaws.com/${options.prefix}/dashboard.html`;
  
  console.log('\nUpload complete!');
  console.log(`Dashboard URL: ${dashboardUrl}`);
  
  if (!options.public) {
    console.log('\nNote: Files are not publicly accessible. To make them public, run with --public flag');
  }
}

uploadFilesToS3().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 