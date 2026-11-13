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
