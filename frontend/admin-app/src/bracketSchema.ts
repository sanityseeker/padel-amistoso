import { useEffect, useState } from 'react';
import { useComputedColorScheme } from '@mantine/core';
import { sanitizeSchemaSvg } from './ui/SchemaSvg';
import type { TvSettings } from './types';

/**
 * Query string for `GET /tournaments/{id}/{prefix}/playoffs-schema` with the organizer's drawing
 * settings, so the TV page, the workspace diagram and the export all draw the same picture.
 */
export function schemaQuery(
  settings: Partial<TvSettings> | null | undefined,
  extra: Record<string, string> = {},
): string {
  const s = settings ?? {};
  return new URLSearchParams({
    fmt: s.schema_format || 'svg',
    box_scale: String(s.schema_box_scale || 1),
    line_width: String(s.schema_line_width || 1),
    arrow_scale: String(s.schema_arrow_scale || 1),
    title_font_scale: String(s.schema_title_font_scale || 1),
    output_scale: String(s.schema_output_scale || 1),
    ...extra,
  }).toString();
}

export type SchemaTheme = 'light' | 'dark';

/** The theme the app shows now: the colours for a downloaded or opened bracket picture. */
export function useSchemaTheme(): SchemaTheme {
  return useComputedColorScheme('light');
}

/** `url` with some query parameters replaced (relative URLs stay relative). */
export function withQuery(url: string, params: Record<string, string>): string {
  const u = new URL(url, window.location.origin);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return `${u.pathname}${u.search}`;
}

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  return new Error(
    typeof body?.detail === 'string' ? body.detail : `Request failed (${res.status})`,
  );
}

/**
 * The bracket drawn as an SVG coloured by CSS variables (`theme=css`), sanitized and ready for
 * `SchemaSvg` / `ZoomableImage svg`. It follows the app theme with no new request. While a changed
 * `url` loads, the previous picture stays, so the page does not jump. `headers` (a stable,
 * module-level function) is only for the organizer workspace; public pages never pass a token.
 */
export function useSchemaSvg(url: string | null, headers?: () => HeadersInit) {
  const [state, setState] = useState<{
    svg: string | null;
    error: string | null;
    loading: boolean;
  }>({ svg: null, error: null, loading: false });
  useEffect(() => {
    if (!url) {
      setState({ svg: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, error: null, loading: true }));
    fetch(withQuery(url, { fmt: 'svg', theme: 'css' }), {
      headers: headers?.(),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw await failure(res);
        const svg = sanitizeSchemaSvg(await res.text());
        if (!svg) throw new Error('The bracket picture could not be read.');
        setState({ svg, error: null, loading: false });
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setState({ svg: null, error: e.message, loading: false });
      });
    return () => controller.abort();
  }, [url, headers]);
  return state;
}

/**
 * Save the bracket as a file in the app's current colours (`theme=light|dark`). `url` already
 * carries the format; the file is named `<filename>.<format>`.
 */
export async function downloadSchema(
  url: string,
  theme: SchemaTheme,
  filename: string,
  headers?: HeadersInit,
): Promise<void> {
  const res = await fetch(withQuery(url, { theme }), { headers });
  if (!res.ok) throw await failure(res);
  const fmt = new URL(url, window.location.origin).searchParams.get('fmt') || 'png';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(await res.blob());
  link.download = `${filename}.${fmt}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
