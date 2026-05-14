import { format, formatDistanceToNowStrict } from "date-fns";

export function formatShortDate(date: Date) {
  return format(date, "MMM d, yyyy");
}

export function formatSchedule(date?: Date | null) {
  if (!date) {
    return "Not scheduled";
  }

  return format(date, "EEE, MMM d · HH:mm");
}

export function formatRelativeTime(date?: Date | null) {
  if (!date) {
    return "No activity yet";
  }

  return `${formatDistanceToNowStrict(date, { addSuffix: true })}`;
}
