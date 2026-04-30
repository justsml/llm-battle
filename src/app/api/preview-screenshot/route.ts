import { capturePreviewScreenshot } from "@/lib/server-preview-screenshot";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    markup?: unknown;
  } | null;

  if (typeof body?.markup !== "string" || !body.markup.trim()) {
    return Response.json(
      { error: "A non-empty markup string is required." },
      { status: 400 },
    );
  }

  try {
    const origin = new URL(request.url).origin;
    const screenshot = await capturePreviewScreenshot({
      markup: body.markup,
      origin,
    });

    return Response.json(screenshot);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to capture the preview screenshot.",
      },
      { status: 500 },
    );
  }
}
