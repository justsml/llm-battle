import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { readDataUrlMeta } from "@/lib/utils";

function getBucketName() {
  return process.env.TIGRIS_BUCKET ?? process.env.BUCKET_NAME ?? "";
}

function getS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION ?? "auto",
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export function isStorageConfigured() {
  return !!(
    getBucketName() &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_ENDPOINT_URL_S3
  );
}

function buildObjectUrl(key: string) {
  const bucket = getBucketName();
  const endpoint = (process.env.AWS_ENDPOINT_URL_S3 ?? "").replace(/\/$/, "");
  return `${endpoint}/${bucket}/${key}`;
}

async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const bucket = getBucketName();
  if (!bucket) {
    throw new Error(
      "Storage is not configured: set TIGRIS_BUCKET or BUCKET_NAME before uploading artifacts.",
    );
  }

  const s3 = getS3Client();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return buildObjectUrl(key);
}

/**
 * Upload a data-URL image to Tigris and return the public URL.
 */
export async function uploadImage(
  key: string,
  dataUrl: string,
): Promise<string> {
  const { mimeType, base64 } = readDataUrlMeta(dataUrl);
  const body = Buffer.from(base64, "base64");
  return uploadObject(key, body, mimeType);
}

export async function uploadText(
  key: string,
  text: string,
  contentType: string,
): Promise<string> {
  return uploadObject(key, Buffer.from(text, "utf8"), contentType);
}
