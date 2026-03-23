import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { readDataUrlMeta } from "@/lib/utils";

const BUCKET = process.env.TIGRIS_BUCKET ?? "llm-battle";

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
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_ENDPOINT_URL_S3
  );
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
  const s3 = getS3Client();

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }),
  );

  // Construct public URL from the S3 endpoint
  const endpoint = (process.env.AWS_ENDPOINT_URL_S3 ?? "").replace(/\/$/, "");
  return `${endpoint}/${BUCKET}/${key}`;
}
