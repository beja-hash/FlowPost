export const isDev = process.env.NODE_ENV !== "production";

export function debugLog(message: string, context?: Record<string, unknown>) {
  if (!isDev) {
    return;
  }

  if (context) {
    console.log(message, context);
    return;
  }

  console.log(message);
}

export function debugWarn(message: string, context?: Record<string, unknown>) {
  if (!isDev) {
    return;
  }

  if (context) {
    console.warn(message, context);
    return;
  }

  console.warn(message);
}
