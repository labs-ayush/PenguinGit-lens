/**
 * Interface representing line blame metadata returned by PenguinGit engine daemon.
 */
export interface BlameLine {
  hash: string;
  authorName: string;
  authorEmail?: string;
  timestamp: number;
  lineNumber: number;
  content?: string;
  summary: string;
  branch?: string;
  branches?: string[];
  refs?: string[];
  ref?: string;
}

/**
 * Formats a Unix timestamp in seconds to a human-readable relative time string.
 */
export function formatRelativeTime(timestampSec: number): string {
  if (!timestampSec) return 'unknown';
  const nowSec = Math.floor(Date.now() / 1000);
  const diffSec = nowSec - timestampSec;

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)}d ago`;
  if (diffSec < 31536000) return `${Math.floor(diffSec / 2592000)}mo ago`;
  return `${Math.floor(diffSec / 31536000)}y ago`;
}

/**
 * Escapes special Markdown characters in text to prevent unintended Markdown formatting or injection.
 */
export function escapeMarkdown(text: string): string {
  if (!text) return '';
  return text.replace(/([\\`*_{}\[\]()#+\-.!|<>]|~)/g, '\\$1');
}
