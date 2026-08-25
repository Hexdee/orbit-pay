export function shortenAddress(address: string, edge = 5) {
  return address.length > edge * 2 ? `${address.slice(0, edge)}…${address.slice(-edge)}` : address;
}

export function formatXlm(value: string | number) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

export function readableError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong. Please try again.";
}
