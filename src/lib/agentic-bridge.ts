type PendingToolResponse = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingToolResponses = new Map<string, PendingToolResponse>();
const TOOL_RESPONSE_TIMEOUT_MS = 30_000;

export function createToolResponsePromise(toolCallId: string) {
  if (pendingToolResponses.has(toolCallId)) {
    throw new Error(`Duplicate tool call id: ${toolCallId}`);
  }

  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingToolResponses.delete(toolCallId);
      reject(new Error("Timed out waiting for the browser tool response."));
    }, TOOL_RESPONSE_TIMEOUT_MS);

    pendingToolResponses.set(toolCallId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      timeout,
    });
  });
}

export function resolveToolResponse(toolCallId: string, value: unknown) {
  const pending = pendingToolResponses.get(toolCallId);
  if (!pending) return false;

  pendingToolResponses.delete(toolCallId);
  pending.resolve(value);
  return true;
}

export function rejectToolResponse(toolCallId: string, message: string) {
  const pending = pendingToolResponses.get(toolCallId);
  if (!pending) return false;

  pendingToolResponses.delete(toolCallId);
  pending.reject(new Error(message));
  return true;
}

export function clearToolResponse(toolCallId: string) {
  const pending = pendingToolResponses.get(toolCallId);
  if (!pending) return false;

  clearTimeout(pending.timeout);
  pendingToolResponses.delete(toolCallId);
  return true;
}
