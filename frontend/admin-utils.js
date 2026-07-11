const API = '';  // same origin

// ─── Icon helper ───────────────────────────────────────────
/**
 * Return an inline SVG icon element for use inside button labels.
 * Icons are stroke-based Lucide-style, inherit currentColor.
 * Usage: `${_ic('trash')} ${t('txt_txt_remove')}`
 */
function _ic(name) {
  const paths = {
    trash:    `<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>`,
    edit:     `<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
    link:     `<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>`,
    reset:    `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>`,
    mail:     `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/>`,
    print:    `<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>`,
    copy:     `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>`,
    key:      `<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>`,
    shield:   `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
    settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>`,
    qr:       `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none"/><line x1="14" y1="14" x2="14" y2="14"/><line x1="17" y1="14" x2="17" y2="14"/><line x1="20" y1="14" x2="20" y2="14"/><line x1="14" y1="17" x2="14" y2="17"/><line x1="17" y1="17" x2="17" y2="17"/><line x1="20" y1="17" x2="20" y2="17"/>`,
    trophy:   `<path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/>`,
    chevdown: `<polyline points="6 9 12 15 18 9"/>`,
    lock:     `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>`,
    unlock:   `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 019.9-1"/>`,
    chart:    `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
    shuffle:  `<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>`,
    monitor:  `<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
    globe:    `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>`,
    users:    `<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>`,
    user:     `<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
    grid:     `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>`,
    building: `<rect x="2" y="7" width="20" height="14" rx="1"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>`,
  };
  const p = paths[name] || '';
  return `<svg class="ic" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

// ─── Ant Design icon helper ────────────────────────────────
/**
 * Return an inline SVG icon using Ant Design Outlined icon paths.
 * Fill-based, viewBox "64 64 896 896", inherits currentColor.
 * Usage: `${_antIc('info-circle')}`
 */
function _antIc(name) {
  const paths = {
    // InfoCircleOutlined
    'info-circle': `<path fill="currentColor" d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372s166.6-372 372-372 372 166.6 372 372-166.6 372-372 372z"/><path fill="currentColor" d="M464 336a48 48 0 1096 0 48 48 0 10-96 0zm72 112h-48c-4.4 0-8 3.6-8 8v272c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8V456c0-4.4-3.6-8-8-8z"/>`,
    // ProfileOutlined — scored list / format chip
    'profile': `<path fill="currentColor" d="M880 112H144c-17.7 0-32 14.3-32 32v736c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V144c0-17.7-14.3-32-32-32zm-40 728H184V184h656v656zM492 400h184c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H492c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8zm0 144h184c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H492c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8zm0 144h184c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H492c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8zM340 368a40 40 0 1080 0 40 40 0 10-80 0zm0 144a40 40 0 1080 0 40 40 0 10-80 0zm0 144a40 40 0 1080 0 40 40 0 10-80 0z"/>`,
    // LockOutlined
    'lock': `<path fill="currentColor" d="M832 464h-68V240c0-70.7-57.3-128-128-128H388c-70.7 0-128 57.3-128 128v224h-68c-17.7 0-32 14.3-32 32v384c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V496c0-17.7-14.3-32-32-32zM332 240c0-30.9 25.1-56 56-56h248c30.9 0 56 25.1 56 56v224H332V240zm460 600H232V536h560v304zM484 701v53c0 4.4 3.6 8 8 8h40c4.4 0 8-3.6 8-8v-53a48.01 48.01 0 10-56 0z"/>`,
    // UnlockOutlined
    'unlock': `<path fill="currentColor" d="M832 464H332V240c0-30.9 25.1-56 56-56h248c30.9 0 56 25.1 56 56v68c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8v-68c0-70.7-57.3-128-128-128H388c-70.7 0-128 57.3-128 128v224h-68c-17.7 0-32 14.3-32 32v384c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V496c0-17.7-14.3-32-32-32zm-40 376H232V536h560v304zM484 701v53c0 4.4 3.6 8 8 8h40c4.4 0 8-3.6 8-8v-53a48.01 48.01 0 10-56 0z"/>`,
    // GlobalOutlined
    'global': `<path fill="currentColor" d="M854.4 800.9c.2-.3.5-.6.7-.9C920.6 722.1 960 621.7 960 512s-39.4-210.1-104.8-288c-.2-.3-.5-.5-.7-.8-1.1-1.3-2.1-2.5-3.2-3.7-.4-.5-.8-.9-1.2-1.4l-4.1-4.7-.1-.1c-1.5-1.7-3.1-3.4-4.6-5.1l-.1-.1c-3.2-3.4-6.4-6.8-9.7-10.1l-.1-.1-4.8-4.8-.3-.3c-1.5-1.5-3-2.9-4.5-4.3-.5-.5-1-1-1.6-1.5-1-1-2-1.9-3-2.8-.3-.3-.7-.6-1-1C736.4 109.2 629.5 64 512 64s-224.4 45.2-304.3 119.2c-.3.3-.7.6-1 1-1 .9-2 1.9-3 2.9-.5.5-1 1-1.6 1.5-1.5 1.4-3 2.9-4.5 4.3l-.3.3-4.8 4.8-.1.1c-3.3 3.3-6.5 6.7-9.7 10.1l-.1.1c-1.6 1.7-3.1 3.4-4.6 5.1l-.1.1c-1.4 1.5-2.8 3.1-4.1 4.7-.4.5-.8.9-1.2 1.4-1.1 1.2-2.1 2.5-3.2 3.7-.2.3-.5.5-.7.8C103.4 301.9 64 402.3 64 512s39.4 210.1 104.8 288c.2.3.5.6.7.9l3.1 3.7c.4.5.8.9 1.2 1.4l4.1 4.7c0 .1.1.1.1.2 1.5 1.7 3 3.4 4.6 5l.1.1c3.2 3.4 6.4 6.8 9.6 10.1l.1.1c1.6 1.6 3.1 3.2 4.7 4.7l.3.3c3.3 3.3 6.7 6.5 10.1 9.6 80.1 74 187 119.2 304.5 119.2s224.4-45.2 304.3-119.2a300 300 0 0010-9.6l.3-.3c1.6-1.6 3.2-3.1 4.7-4.7l.1-.1c3.3-3.3 6.5-6.7 9.6-10.1l.1-.1c1.5-1.7 3.1-3.3 4.6-5 0-.1.1-.1.1-.2 1.4-1.5 2.8-3.1 4.1-4.7.4-.5.8-.9 1.2-1.4a99 99 0 003.3-3.7zm4.1-142.6c-13.8 32.6-32 62.8-54.2 90.2a444.07 444.07 0 00-81.5-55.9c11.6-46.9 18.8-98.4 20.7-152.6H887c-3 40.9-12.6 80.6-28.5 118.3zM887 484H743.5c-1.9-54.2-9.1-105.7-20.7-152.6 29.3-15.6 56.6-34.4 81.5-55.9A373.86 373.86 0 01887 484zM658.3 165.5c39.7 16.8 75.8 40 107.6 69.2a394.72 394.72 0 01-59.4 41.8c-15.7-45-35.8-84.1-59.2-115.4 3.7 1.4 7.4 2.9 11 4.4zm-90.6 700.6c-9.2 7.2-18.4 12.7-27.7 16.4V697a389.1 389.1 0 01115.7 26.2c-8.3 24.6-17.9 47.3-29 67.8-17.4 32.4-37.8 58.3-59 75.1zm59-633.1c11 20.6 20.7 43.3 29 67.8A389.1 389.1 0 01540 327V141.6c9.2 3.7 18.5 9.1 27.7 16.4 21.2 16.7 41.6 42.6 59 75zM540 640.9V540h147.5c-1.6 44.2-7.1 87.1-16.3 127.8l-.3 1.2A445.02 445.02 0 00540 640.9zm0-156.9V383.1c45.8-2.8 89.8-12.5 130.9-28.1l.3 1.2c9.2 40.7 14.7 83.5 16.3 127.8H540zm-56 56v100.9c-45.8 2.8-89.8 12.5-130.9 28.1l-.3-1.2c-9.2-40.7-14.7-83.5-16.3-127.8H484zm-147.5-56c1.6-44.2 7.1-87.1 16.3-127.8l.3-1.2c41.1 15.6 85 25.3 130.9 28.1V484H336.5zM484 697v185.4c-9.2-3.7-18.5-9.1-27.7-16.4-21.2-16.7-41.7-42.7-59.1-75.1-11-20.6-20.7-43.3-29-67.8 37.2-14.6 75.9-23.3 115.8-26.1zm0-370a389.1 389.1 0 01-115.7-26.2c8.3-24.6 17.9-47.3 29-67.8 17.4-32.4 37.8-58.4 59.1-75.1 9.2-7.2 18.4-12.7 27.7-16.4V327zM365.7 165.5c3.7-1.5 7.3-3 11-4.4-23.4 31.3-43.5 70.4-59.2 115.4-21-12-40.9-26-59.4-41.8 31.8-29.2 67.9-52.4 107.6-69.2zM165.5 365.7c13.8-32.6 32-62.8 54.2-90.2 24.9 21.5 52.2 40.3 81.5 55.9-11.6 46.9-18.8 98.4-20.7 152.6H137c3-40.9 12.6-80.6 28.5-118.3zM137 540h143.5c1.9 54.2 9.1 105.7 20.7 152.6a444.07 444.07 0 00-81.5 55.9A373.86 373.86 0 01137 540zm228.7 318.5c-39.7-16.8-75.8-40-107.6-69.2 18.5-15.8 38.4-29.7 59.4-41.8 15.7 45 35.8 84.1 59.2 115.4-3.7-1.4-7.4-2.9-11-4.4zm292.6 0c-3.7 1.5-7.3 3-11 4.4 23.4-31.3 43.5-70.4 59.2-115.4 21 12 40.9 26 59.4 41.8a373.81 373.81 0 01-107.6 69.2z"/>`,
    // TeamOutlined
    'team': `<path fill="currentColor" d="M824.2 699.9a301.55 301.55 0 00-86.4-60.4C783.1 602.8 812 546.8 812 484c0-110.8-92.4-201.7-203.2-200-109.1 1.7-197 90.6-197 200 0 62.8 29 118.8 74.2 155.5a300.95 300.95 0 00-86.4 60.4C345 754.6 314 826.8 312 903.8a8 8 0 008 8.2h56c4.3 0 7.9-3.4 8-7.7 1.9-58 25.4-112.3 66.7-153.5A226.62 226.62 0 01612 684c60.9 0 118.2 23.7 161.3 66.8C814.5 792 838 846.3 840 904.3c.1 4.3 3.7 7.7 8 7.7h56a8 8 0 008-8.2c-2-77-33-149.2-87.8-203.9zM612 612c-34.2 0-66.4-13.3-90.5-37.5a126.86 126.86 0 01-37.5-91.8c.3-32.8 13.4-64.5 36.3-88 24-24.6 56.1-38.3 90.4-38.7 33.9-.3 66.8 12.9 91 36.6 24.8 24.3 38.4 56.8 38.4 91.4 0 34.2-13.3 66.3-37.5 90.5A127.3 127.3 0 01612 612zM361.5 510.4c-.9-8.7-1.4-17.5-1.4-26.4 0-15.9 1.5-31.4 4.3-46.5.7-3.6-1.2-7.3-4.5-8.8-13.6-6.1-26.1-14.5-36.9-25.1a127.54 127.54 0 01-38.7-95.4c.9-32.1 13.8-62.6 36.3-85.6 24.7-25.3 57.9-39.1 93.2-38.7 31.9.3 62.7 12.6 86 34.4 7.9 7.4 14.7 15.6 20.4 24.4 2 3.1 5.9 4.4 9.3 3.2 17.6-6.1 36.2-10.4 55.3-12.4 5.6-.6 8.8-6.6 6.3-11.6-32.5-64.3-98.9-108.7-175.7-109.9-110.9-1.7-203.3 89.2-203.3 199.9 0 62.8 28.9 118.8 74.2 155.5-31.8 14.7-61.1 35-86.5 60.4-54.8 54.7-85.8 126.9-87.8 204a8 8 0 008 8.2h56.1c4.3 0 7.9-3.4 8-7.7 1.9-58 25.4-112.3 66.7-153.5 29.4-29.4 65.4-49.8 104.7-59.7 3.9-1 6.5-4.7 6-8.7z"/>`,
    // UserOutlined
    'user': `<path fill="currentColor" d="M858.5 763.6a374 374 0 00-80.6-119.5 375.63 375.63 0 00-119.5-80.6c-.4-.2-.8-.3-1.2-.5C719.5 518 760 444.7 760 362c0-137-111-248-248-248S264 225 264 362c0 82.7 40.5 156 102.8 201.1-.4.2-.8.3-1.2.5-44.8 18.9-85 46-119.5 80.6a375.63 375.63 0 00-80.6 119.5A371.7 371.7 0 00136 901.8a8 8 0 008 8.2h60c4.4 0 7.9-3.5 8-7.8 2-77.2 33-149.5 87.8-204.3 56.7-56.7 132-87.9 212.2-87.9s155.5 31.2 212.2 87.9C779 752.7 810 825 812 902.2c.1 4.4 3.6 7.8 8 7.8h60a8 8 0 008-8.2c-1-47.8-10.9-94.3-29.5-138.2zM512 534c-45.9 0-89.1-17.9-121.6-50.4S340 407.9 340 362c0-45.9 17.9-89.1 50.4-121.6S466.1 190 512 190s89.1 17.9 121.6 50.4S684 316.1 684 362c0 45.9-17.9 89.1-50.4 121.6S557.9 534 512 534z"/>`,
    // SearchOutlined
    'search': `<path fill="currentColor" d="M909.6 854.5L649.9 594.8C690.2 542.7 712 479 712 412c0-80.2-31.3-155.4-87.9-212.1-56.6-56.7-132-87.9-212.1-87.9s-155.5 31.3-212.1 87.9C143.2 256.5 112 331.8 112 412c0 80.1 31.3 155.5 87.9 212.1C256.5 680.8 331.8 712 412 712c67 0 130.6-21.8 182.7-62l259.7 259.6a8.2 8.2 0 0011.6 0l43.6-43.5a8.2 8.2 0 000-11.6zM570.4 570.4C528 612.7 471.8 636 412 636s-116-23.3-158.4-65.6C211.3 528 188 471.8 188 412s23.3-116.1 65.6-158.4C296 211.3 352.2 188 412 188s116.1 23.2 158.4 65.6S636 352.2 636 412s-23.3 116.1-65.6 158.4z"/>`,
    // SyncOutlined
    'sync': `<path fill="currentColor" d="M168 504.2c1-43.7 10-86.1 26.9-126 17.3-41 42.1-77.7 73.7-109.4S337 212.3 378 195c42.4-17.9 87.4-27 133.9-27s91.5 9.1 133.8 27A341.5 341.5 0 01755 268.8c9.9 9.9 19.2 20.4 27.8 31.4l-60.2 47a8 8 0 003 14.1l175.7 43c5 1.2 9.9-2.6 9.9-7.7l.8-180.9c0-6.7-7.7-10.5-12.9-6.3l-56.4 44.1C765.8 155.1 646.2 92 511.8 92 282.7 92 96.3 275.6 92 503.8a8 8 0 008 8.2h60c4.4 0 7.9-3.5 8-7.8zm756 7.8h-60c-4.4 0-7.9 3.5-8 7.8-1 43.7-10 86.1-26.9 126-17.3 41-42.1 77.8-73.7 109.4A342.45 342.45 0 01512.1 856a342.24 342.24 0 01-243.2-100.8c-9.9-9.9-19.2-20.4-27.8-31.4l60.2-47a8 8 0 00-3-14.1l-175.7-43c-5-1.2-9.9 2.6-9.9 7.7l-.7 181c0 6.7 7.7 10.5 12.9 6.3l56.4-44.1C258.2 868.9 377.8 932 512.2 932c229.2 0 415.5-183.7 419.8-411.8a8 8 0 00-8-8.2z"/>`,
    // WarningOutlined
    'warning': `<path fill="currentColor" d="M464 720a48 48 0 1096 0 48 48 0 10-96 0zm16-304v184c0 4.4 3.6 8 8 8h48c4.4 0 8-3.6 8-8V416c0-4.4-3.6-8-8-8h-48c-4.4 0-8 3.6-8 8zm475.7 440l-416-720c-6.2-10.7-16.9-16-27.7-16s-21.6 5.3-27.7 16l-416 720C56 877.4 71.4 904 96 904h832c24.6 0 40-26.6 27.7-48zm-783.5-27.9L512 239.9l339.8 588.2H172.2z"/>`,
    // MessageOutlined
    'message': `<path fill="currentColor" d="M464 512a48 48 0 1096 0 48 48 0 10-96 0zm200 0a48 48 0 1096 0 48 48 0 10-96 0zm-400 0a48 48 0 1096 0 48 48 0 10-96 0zm661.2-173.6c-22.6-53.7-55-101.9-96.3-143.3a444.35 444.35 0 00-143.3-96.3C630.6 75.7 572.2 64 512 64h-2c-60.6.3-119.3 12.3-174.5 35.9a445.35 445.35 0 00-142 96.5c-40.9 41.3-73 89.3-95.2 142.8-23 55.4-34.6 114.3-34.3 174.9A449.4 449.4 0 00112 714v152a46 46 0 0046 46h152.1A449.4 449.4 0 00510 960h2.1c59.9 0 118-11.6 172.7-34.3a444.48 444.48 0 00142.8-95.2c41.3-40.9 73.8-88.7 96.5-142 23.6-55.2 35.6-113.9 35.9-174.5.3-60.9-11.5-120-34.8-175.6zm-151.1 438C704 845.8 611 884 512 884h-1.7c-60.3-.3-120.2-15.3-173.1-43.5l-8.4-4.5H188V695.2l-4.5-8.4C155.3 633.9 140.3 574 140 513.7c-.4-99.7 37.7-193.3 107.6-263.8 69.8-70.5 163.1-109.5 262.8-109.9h1.7c50 0 98.5 9.7 144.2 28.9 44.6 18.7 84.6 45.6 119 80 34.3 34.3 61.3 74.4 80 119 19.4 46.2 29.1 95.2 28.9 145.8-.6 99.6-39.7 192.9-110.1 262.7z"/>`,
    // BarChartOutlined
    'bar-chart': `<path fill="currentColor" d="M888 792H200V168c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v688c0 4.4 3.6 8 8 8h752c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8zm-600-80h56c4.4 0 8-3.6 8-8V560c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v144c0 4.4 3.6 8 8 8zm152 0h56c4.4 0 8-3.6 8-8V384c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v320c0 4.4 3.6 8 8 8zm152 0h56c4.4 0 8-3.6 8-8V462c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v242c0 4.4 3.6 8 8 8zm152 0h56c4.4 0 8-3.6 8-8V304c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v400c0 4.4 3.6 8 8 8z"/>`,
    // PushpinOutlined
    'pushpin': `<path fill="currentColor" d="M878.3 392.1L631.9 145.7c-6.5-6.5-15-9.7-23.5-9.7s-17 3.2-23.5 9.7L423.8 306.9c-12.2-1.4-24.5-2-36.8-2-73.2 0-146.4 24.1-206.5 72.3a33.23 33.23 0 00-2.7 49.4l181.7 181.7-215.4 215.2a15.8 15.8 0 00-4.6 9.8l-3.4 37.2c-.9 9.4 6.6 17.4 15.9 17.4.5 0 1 0 1.5-.1l37.2-3.4c3.7-.3 7.2-2 9.8-4.6l215.4-215.4 181.7 181.7c6.5 6.5 15 9.7 23.5 9.7 9.7 0 19.3-4.2 25.9-12.4 56.3-70.3 79.7-158.3 70.2-243.4l161.1-161.1c12.9-12.8 12.9-33.8 0-46.8zM666.2 549.3l-24.5 24.5 3.8 34.4a259.92 259.92 0 01-30.4 153.9L262 408.8c12.9-7.1 26.3-13.1 40.3-17.9 27.2-9.4 55.7-14.1 84.7-14.1 9.6 0 19.3.5 28.9 1.6l34.4 3.8 24.5-24.5L608.5 224 800 415.5 666.2 549.3z"/>`,
    // CalendarOutlined
    'calendar': `<path fill="currentColor" d="M880 184H712v-64c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v64H384v-64c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v64H144c-17.7 0-32 14.3-32 32v664c0 17.7 14.3 32 32 32h736c17.7 0 32-14.3 32-32V216c0-17.7-14.3-32-32-32zm-40 656H184V460h656v380zM184 392V256h128v48c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8v-48h256v48c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8v-48h128v136H184z"/>`,
    // NotificationOutlined
    'notification': `<path fill="currentColor" d="M880 112c-3.8 0-7.7.7-11.6 2.3L292 345.9H128c-8.8 0-16 7.4-16 16.6v299c0 9.2 7.2 16.6 16 16.6h101.7c-3.7 11.6-5.7 23.9-5.7 36.4 0 65.9 53.8 119.5 120 119.5 55.4 0 102.1-37.6 115.9-88.4l408.6 164.2c3.9 1.5 7.8 2.3 11.6 2.3 16.9 0 32-14.2 32-33.2V145.2C912 126.2 897 112 880 112zM344 762.3c-26.5 0-48-21.4-48-47.8 0-11.2 3.9-21.9 11-30.4l84.9 34.1c-2 24.6-22.7 44.1-47.9 44.1zm496 58.4L318.8 611.3l-12.9-5.2H184V417.9h121.9l12.9-5.2L840 203.3v617.4z"/>`,
    // ThunderboltOutlined
    'thunderbolt': `<path fill="currentColor" d="M848 359.3H627.7L825.8 109c4.1-5.3.4-13-6.3-13H436c-2.8 0-5.5 1.5-6.9 4L170 547.5c-3.1 5.3.7 12 6.9 12h174.4l-89.4 357.6c-1.9 7.8 7.5 13.3 13.3 7.7L853.5 373c5.2-4.9 1.7-13.7-5.5-13.7zM378.2 732.5l60.3-241H281.1l189.6-327.4h224.6L487 427.4h211L378.2 732.5z"/>`,
    // StopOutlined
    'stop': `<path fill="currentColor" d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64zm0 820c-205.4 0-372-166.6-372-372 0-89 31.3-170.8 83.5-234.8l523.3 523.3C682.8 852.7 601 884 512 884zm288.5-137.2L277.2 223.5C341.2 171.3 423 140 512 140c205.4 0 372 166.6 372 372 0 89-31.3 170.8-83.5 234.8z"/>`,
    // RetweetOutlined
    'retweet': `<path fill="currentColor" d="M136 552h63.6c4.4 0 8-3.6 8-8V288.7h528.6v72.6c0 1.9.6 3.7 1.8 5.2a8.3 8.3 0 0011.7 1.4L893 255.4c4.3-5 3.6-10.3 0-13.2L749.7 129.8a8.22 8.22 0 00-5.2-1.8c-4.6 0-8.4 3.8-8.4 8.4V209H199.7c-39.5 0-71.7 32.2-71.7 71.8V544c0 4.4 3.6 8 8 8zm752-80h-63.6c-4.4 0-8 3.6-8 8v255.3H287.8v-72.6c0-1.9-.6-3.7-1.8-5.2a8.3 8.3 0 00-11.7-1.4L131 768.6c-4.3 5-3.6 10.3 0 13.2l143.3 112.4c1.5 1.2 3.3 1.8 5.2 1.8 4.6 0 8.4-3.8 8.4-8.4V815h536.6c39.5 0 71.7-32.2 71.7-71.8V480c-.2-4.4-3.8-8-8.2-8z"/>`,
    // DesktopOutlined
    'desktop': `<path fill="currentColor" d="M928 140H96c-17.7 0-32 14.3-32 32v496c0 17.7 14.3 32 32 32h380v112H304c-8.8 0-16 7.2-16 16v48c0 4.4 3.6 8 8 8h432c4.4 0 8-3.6 8-8v-48c0-8.8-7.2-16-16-16H548V700h380c17.7 0 32-14.3 32-32V172c0-17.7-14.3-32-32-32zm-40 488H136V212h752v416z"/>`,
    // ToolOutlined
    'tool': `<path fill="currentColor" d="M876.6 239.5c-.5-.9-1.2-1.8-2-2.5-5-5-13.1-5-18.1 0L684.2 409.3l-67.9-67.9L788.7 169c.8-.8 1.4-1.6 2-2.5 3.6-6.1 1.6-13.9-4.5-17.5-98.2-58-226.8-44.7-311.3 39.7-67 67-89.2 162-66.5 247.4l-293 293c-3 3-2.8 7.9.3 11l169.7 169.7c3.1 3.1 8.1 3.3 11 .3l292.9-292.9c85.5 22.8 180.5.7 247.6-66.4 84.4-84.5 97.7-213.1 39.7-311.3zM786 499.8c-58.1 58.1-145.3 69.3-214.6 33.6l-8.8 8.8-.1-.1-274 274.1-79.2-79.2 230.1-230.1s0 .1.1.1l52.8-52.8c-35.7-69.3-24.5-156.5 33.6-214.6a184.2 184.2 0 01144-53.5L537 318.9a32.05 32.05 0 000 45.3l124.5 124.5a32.05 32.05 0 0045.3 0l132.8-132.8c3.7 51.8-14.4 104.8-53.6 143.9z"/>`,
    // FileTextOutlined
    'file-text': `<path fill="currentColor" d="M854.6 288.6L639.4 73.4c-6-6-14.1-9.4-22.6-9.4H192c-17.7 0-32 14.3-32 32v832c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V311.3c0-8.5-3.4-16.7-9.4-22.7zM790.2 326H602V137.8L790.2 326zm1.8 562H232V136h302v216a42 42 0 0042 42h216v494zM504 618H320c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8h184c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8zM312 490v48c0 4.4 3.6 8 8 8h384c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H320c-4.4 0-8 3.6-8 8z"/>`,
    // SettingOutlined
    'setting': `<path fill="currentColor" d="M924.8 625.7l-65.5-56c3.1-19 4.7-38.4 4.7-57.8s-1.6-38.8-4.7-57.8l65.5-56a32.03 32.03 0 009.3-35.2l-.9-2.6a443.74 443.74 0 00-79.7-137.9l-1.8-2.1a32.12 32.12 0 00-35.1-9.5l-81.3 28.9c-30-24.6-63.5-44-99.7-57.6l-15.7-85a32.05 32.05 0 00-25.8-25.7l-2.7-.5c-52.1-9.4-106.9-9.4-159 0l-2.7.5a32.05 32.05 0 00-25.8 25.7l-15.8 85.4a351.86 351.86 0 00-99 57.4l-81.9-29.1a32 32 0 00-35.1 9.5l-1.8 2.1a446.02 446.02 0 00-79.7 137.9l-.9 2.6c-4.5 12.5-.8 26.5 9.3 35.2l66.3 56.6c-3.1 18.8-4.6 38-4.6 57.1 0 19.2 1.5 38.4 4.6 57.1L99 625.5a32.03 32.03 0 00-9.3 35.2l.9 2.6c18.1 50.4 44.9 96.9 79.7 137.9l1.8 2.1a32.12 32.12 0 0035.1 9.5l81.9-29.1c29.8 24.5 63.1 43.9 99 57.4l15.8 85.4a32.05 32.05 0 0025.8 25.7l2.7.5a449.4 449.4 0 00159 0l2.7-.5a32.05 32.05 0 0025.8-25.7l15.7-85a350 350 0 0099.7-57.6l81.3 28.9a32 32 0 0035.1-9.5l1.8-2.1c34.8-41.1 61.6-87.5 79.7-137.9l.9-2.6c4.5-12.3.8-26.3-9.3-35zM788.3 465.9c2.5 15.1 3.8 30.6 3.8 46.1s-1.3 31-3.8 46.1l-6.6 40.1 74.7 63.9a370.03 370.03 0 01-42.6 73.6L721 702.8l-31.4 25.8c-23.9 19.6-50.5 35-79.3 45.8l-38.1 14.3-17.9 97a377.5 377.5 0 01-85 0l-17.9-97.2-37.8-14.5c-28.5-10.8-55-26.2-78.7-45.7l-31.4-25.9-93.4 33.2c-17-22.9-31.2-47.6-42.6-73.6l75.5-64.5-6.5-40c-2.4-14.9-3.7-30.3-3.7-45.5 0-15.3 1.2-30.6 3.7-45.5l6.5-40-75.5-64.5c11.3-26.1 25.6-50.7 42.6-73.6l93.4 33.2 31.4-25.9c23.7-19.5 50.2-34.9 78.7-45.7l37.9-14.3 17.9-97.2c28.1-3.2 56.8-3.2 85 0l17.9 97 38.1 14.3c28.7 10.8 55.4 26.2 79.3 45.8l31.4 25.8 92.8-32.9c17 22.9 31.2 47.6 42.6 73.6L781.8 426l6.5 39.9zM512 326c-97.2 0-176 78.8-176 176s78.8 176 176 176 176-78.8 176-176-78.8-176-176-176zm79.2 255.2A111.6 111.6 0 01512 614c-29.9 0-58-11.7-79.2-32.8A111.6 111.6 0 01400 502c0-29.9 11.7-58 32.8-79.2C454 401.6 482.1 390 512 390c29.9 0 58 11.6 79.2 32.8A111.6 111.6 0 01624 502c0 29.9-11.7 58-32.8 79.2z"/>`,
    // LinkOutlined
    'link': `<path fill="currentColor" d="M574 665.4a8.03 8.03 0 00-11.3 0L446.5 781.6c-53.8 53.8-144.6 59.5-204 0-59.5-59.5-53.8-150.2 0-204l116.2-116.2c3.1-3.1 3.1-8.2 0-11.3l-39.8-39.8a8.03 8.03 0 00-11.3 0L191.4 526.5c-84.6 84.6-84.6 221.5 0 306s221.5 84.6 306 0l116.2-116.2c3.1-3.1 3.1-8.2 0-11.3L574 665.4zm258.6-474c-84.6-84.6-221.5-84.6-306 0L410.3 307.6a8.03 8.03 0 000 11.3l39.7 39.7c3.1 3.1 8.2 3.1 11.3 0l116.2-116.2c53.8-53.8 144.6-59.5 204 0 59.5 59.5 53.8 150.2 0 204L665.3 562.6a8.03 8.03 0 000 11.3l39.8 39.8c3.1 3.1 8.2 3.1 11.3 0l116.2-116.2c84.5-84.6 84.5-221.5 0-306.1zM610.1 372.3a8.03 8.03 0 00-11.3 0L372.3 598.7a8.03 8.03 0 000 11.3l39.6 39.6c3.1 3.1 8.2 3.1 11.3 0l226.4-226.4c3.1-3.1 3.1-8.2 0-11.3l-39.5-39.6z"/>`,
    // EditOutlined
    'edit': `<path fill="currentColor" d="M257.7 752c2 0 4-.2 6-.5L431.9 722c2-.4 3.9-1.3 5.3-2.8l423.9-423.9a9.96 9.96 0 000-14.1L694.9 114.9c-1.9-1.9-4.4-2.9-7.1-2.9s-5.2 1-7.1 2.9L256.8 538.8c-1.5 1.5-2.4 3.3-2.8 5.3l-29.5 168.2a33.5 33.5 0 009.4 29.8c6.6 6.4 14.9 9.9 23.8 9.9zm67.4-174.4L687.8 215l73.3 73.3-362.7 362.6-88.9 15.7 15.6-89zM880 836H144c-17.7 0-32 14.3-32 32v36c0 4.4 3.6 8 8 8h784c4.4 0 8-3.6 8-8v-36c0-17.7-14.3-32-32-32z"/>`,
    // MailOutlined
    'mail': `<path fill="currentColor" d="M928 160H96c-17.7 0-32 14.3-32 32v640c0 17.7 14.3 32 32 32h832c17.7 0 32-14.3 32-32V192c0-17.7-14.3-32-32-32zm-40 110.8V792H136V270.8l-27.6-21.5 39.3-50.5 42.8 33.3h643.1l42.8-33.3 39.3 50.5-27.7 21.5zM833.6 232L512 482 190.4 232l-42.8-33.3-39.3 50.5 27.6 21.5 341.6 265.6a55.99 55.99 0 0068.7 0L888 270.8l27.6-21.5-39.3-50.5-42.7 33.2z"/>`,
    // KeyOutlined
    'key': `<path fill="currentColor" d="M608 112c-167.9 0-304 136.1-304 304 0 70.3 23.9 135 63.9 186.5l-41.1 41.1-62.3-62.3a8.15 8.15 0 00-11.4 0l-39.8 39.8a8.15 8.15 0 000 11.4l62.3 62.3-44.9 44.9-62.3-62.3a8.15 8.15 0 00-11.4 0l-39.8 39.8a8.15 8.15 0 000 11.4l62.3 62.3-65.3 65.3a8.03 8.03 0 000 11.3l42.3 42.3c3.1 3.1 8.2 3.1 11.3 0l253.6-253.6A304.06 304.06 0 00608 720c167.9 0 304-136.1 304-304S775.9 112 608 112zm161.2 465.2C726.2 620.3 668.9 644 608 644c-60.9 0-118.2-23.7-161.2-66.8-43.1-43-66.8-100.3-66.8-161.2 0-60.9 23.7-118.2 66.8-161.2 43-43.1 100.3-66.8 161.2-66.8 60.9 0 118.2 23.7 161.2 66.8 43.1 43 66.8 100.3 66.8 161.2 0 60.9-23.7 118.2-66.8 161.2z"/>`,
    // PlusOutlined
    'plus': `<path fill="currentColor" d="M482 152h60q8 0 8 8v704q0 8-8 8h-60q-8 0-8-8V160q0-8 8-8z"/><path fill="currentColor" d="M192 474h672q8 0 8 8v60q0 8-8 8H160q-8 0-8-8v-60q0-8 8-8z"/>`,
    // TagOutlined
    'tag': `<path fill="currentColor" d="M938 458.8l-29.6-312.6c-1.5-16.2-14.4-29-30.6-30.6L565.2 86h-.4c-3.2 0-5.7 1-7.6 2.9L88.9 557.2a9.96 9.96 0 000 14.1l363.8 363.8c1.9 1.9 4.4 2.9 7.1 2.9s5.2-1 7.1-2.9l468.3-468.3c2-2.1 3-5 2.8-8zM459.7 834.7L189.3 564.3 589 164.6 836 188l23.4 247-399.7 399.7zM680 256c-48.5 0-88 39.5-88 88s39.5 88 88 88 88-39.5 88-88-39.5-88-88-88zm0 120c-17.7 0-32-14.3-32-32s14.3-32 32-32 32 14.3 32 32-14.3 32-32 32z"/>`,
    // CameraOutlined
    'camera': `<path fill="currentColor" d="M864 248H728l-32.4-90.8a32.07 32.07 0 00-30.2-21.2H358.6c-13.5 0-25.6 8.5-30.1 21.2L296 248H160c-44.2 0-80 35.8-80 80v456c0 44.2 35.8 80 80 80h704c44.2 0 80-35.8 80-80V328c0-44.2-35.8-80-80-80zm8 536c0 4.4-3.6 8-8 8H160c-4.4 0-8-3.6-8-8V328c0-4.4 3.6-8 8-8h186.7l17.1-47.8 22.9-64.2h250.5l22.9 64.2 17.1 47.8H864c4.4 0 8 3.6 8 8v456zM512 384c-88.4 0-160 71.6-160 160s71.6 160 160 160 160-71.6 160-160-71.6-160-160-160zm0 256c-53 0-96-43-96-96s43-96 96-96 96 43 96 96-43 96-96 96z"/>`,
    // SafetyOutlined (viewBox 0 0 1024 1024)
    'safety': `<path fill="currentColor" d="M512 64L128 192v384c0 212.1 171.9 384 384 384s384-171.9 384-384V192L512 64zm312 512c0 172.3-139.7 312-312 312S200 748.3 200 576V246l312-110 312 110v330z"/><path fill="currentColor" d="M378.4 475.1a35.91 35.91 0 00-50.9 0 35.91 35.91 0 000 50.9l129.4 129.4 2.1 2.1a33.98 33.98 0 0048.1 0L730.6 434a33.98 33.98 0 000-48.1l-2.8-2.8a33.98 33.98 0 00-48.1 0L483 579.7 378.4 475.1z"/>`,
    // ContainerOutlined
    'container': `<path fill="currentColor" d="M832 64H192c-17.7 0-32 14.3-32 32v832c0 17.7 14.3 32 32 32h640c17.7 0 32-14.3 32-32V96c0-17.7-14.3-32-32-32zm-40 824H232V687h97.9c11.6 32.8 32 62.3 59.1 84.7 34.5 28.5 78.2 44.3 123 44.3s88.5-15.7 123-44.3c27.1-22.4 47.5-51.9 59.1-84.7H792v-63H643.6l-5.2 24.7C626.4 708.5 573.2 752 512 752s-114.4-43.5-126.5-103.3l-5.2-24.7H232V136h560v752zM320 341h384c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H320c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8zm0 160h384c4.4 0 8-3.6 8-8v-48c0-4.4-3.6-8-8-8H320c-4.4 0-8 3.6-8 8v48c0 4.4 3.6 8 8 8z"/>`,
    // ContactsOutlined
    'contacts': `<path fill="currentColor" d="M594.3 601.5a111.8 111.8 0 0029.1-75.5c0-61.9-49.9-112-111.4-112s-111.4 50.1-111.4 112c0 29.1 11 55.5 29.1 75.5a158.09 158.09 0 00-74.6 126.1 8 8 0 008 8.4H407c4.2 0 7.6-3.3 7.9-7.5 3.8-50.6 46-90.5 97.2-90.5s93.4 40 97.2 90.5c.3 4.2 3.7 7.5 7.9 7.5H661a8 8 0 008-8.4c-2.8-53.3-32-99.7-74.7-126.1zM512 578c-28.5 0-51.7-23.3-51.7-52s23.2-52 51.7-52 51.7 23.3 51.7 52-23.2 52-51.7 52zm416-354H768v-56c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v56H548v-56c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v56H328v-56c0-4.4-3.6-8-8-8h-56c-4.4 0-8 3.6-8 8v56H96c-17.7 0-32 14.3-32 32v576c0 17.7 14.3 32 32 32h832c17.7 0 32-14.3 32-32V256c0-17.7-14.3-32-32-32zm-40 568H136V296h120v56c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8v-56h148v56c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8v-56h148v56c0 4.4 3.6 8 8 8h56c4.4 0 8-3.6 8-8v-56h120v496z"/>`,
  };
  const p = paths[name] || '';
  return `<svg class="ic" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="64 64 896 896" fill="currentColor">${p}</svg>`;
}

// Check if running in demo mode and show warning banner
(async function checkDemoMode() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    if (config && config.amistoso_domain) {
      window.__AMISTOSO_DOMAIN__ = String(config.amistoso_domain).toLowerCase();
    }
    const demoBanner = document.getElementById('demo-banner');
    if (config.demo_mode && demoBanner) {
      demoBanner.style.display = 'block';
    }
  } catch (err) {
    console.warn('Could not fetch config:', err);
  }
})();

// ─── Tab switching ─────────────────────────────────────────
function setActiveTab(tabName) {
  if (tabName === 'view' && !currentTid) return;
  // Deactivate main tabs (but not chips — they manage their own active state)
  document.querySelectorAll('.tab-btn:not(.tournament-chip)').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel-' + tabName);
  if (!panel) return;
  panel.classList.add('active');
  const refreshBtn = document.getElementById('admin-refresh-btn');
  if (refreshBtn) refreshBtn.style.display = (tabName === 'view' && currentTid) ? '' : 'none';
  if (tabName === 'view') {
    _stopRegPoll();
    // Restart registration detail poll if currently viewing a registration
    if (currentType === 'registration') _startRegDetailPoll();
    // Highlight the chip for the currently active tournament
    document.querySelectorAll('.tournament-chip').forEach(b => b.classList.toggle('active', b.dataset.tid === currentTid));
  } else {
    document.querySelectorAll('.tournament-chip').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
    }
    if (tabName === 'home' && isAuthenticated()) { loadTournaments(); _startRegPoll(); } else { _stopRegPoll(); }
    if (tabName === 'players-hub' && isAuthenticated()) { phSearch(); }
    if (tabName === 'user-mgmt' && isAuthenticated()) { loadUserMgmtList(); }
    if (tabName === 'communities' && isAuthenticated()) { loadCommunitiesPanel(); }
    if (tabName === 'clubs' && isAuthenticated()) { loadClubsPanel(); }
    _stopRegDetailPoll();
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const tab = btn.dataset.tab;
    setActiveTab(tab);
    if (!isAuthenticated() && (tab === 'home' || tab === 'create')) {
      showLoginDialog();
    }
  });
});

let _currentCreateMode = 'gp';

function setCreateMode(mode) {
  _currentCreateMode = mode;
  const isGp = mode === 'gp';
  const isMex = mode === 'mex';
  const isPo = mode === 'po';
  const isLobby = mode === 'lobby';
  document.getElementById('create-tab-gp')?.classList.toggle('active', isGp);
  document.getElementById('create-tab-mex')?.classList.toggle('active', isMex);
  document.getElementById('create-tab-po')?.classList.toggle('active', isPo);
  document.getElementById('create-tab-lobby')?.classList.toggle('active', isLobby);
  document.getElementById('create-panel-gp')?.classList.toggle('active', isGp);
  document.getElementById('create-panel-mex')?.classList.toggle('active', isMex);
  document.getElementById('create-panel-po')?.classList.toggle('active', isPo);
  document.getElementById('create-panel-lobby')?.classList.toggle('active', isLobby);
  document.getElementById('entry-toggle-gp-wrap')?.classList.toggle('hidden', !isGp);
  document.getElementById('entry-toggle-mex-wrap')?.classList.toggle('hidden', !isMex);
  document.getElementById('entry-toggle-po-wrap')?.classList.toggle('hidden', !isPo);
  if (typeof syncCreateEntryCardVisibility === 'function') syncCreateEntryCardVisibility();
  if (isLobby) showCreateRegistration();
}

// ─── Format info modal ─────────────────────────────────────
function openFormatInfo(format) {
  const mode = format || _currentCreateMode;
  let htmlFn;
  if (mode === 'lobby') htmlFn = _lobbyFormatInfoHtml;
  else if (mode === 'mex') htmlFn = _mexFormatInfoHtml;
  else if (mode === 'po') htmlFn = _poFormatInfoHtml;
  else htmlFn = _gpFormatInfoHtml;
  document.getElementById('format-info-content').innerHTML = htmlFn();
  document.getElementById('format-info-overlay').style.display = 'block';
  document.getElementById('format-info-dialog').style.display = 'block';
}

function closeFormatInfo() {
  document.getElementById('format-info-overlay').style.display = 'none';
  document.getElementById('format-info-dialog').style.display = 'none';
}

// ─── Context info modal (Communities / Clubs) ─────────────
function _commInfoHtml() {
  return `
    <h3 id="format-info-heading">${esc(t('txt_comm_info_panel_title'))}</h3>
    <p>${esc(t('txt_comm_info_panel_subtitle'))}</p>
    <h4>${esc(t('txt_comm_info_tip_scope_title'))}</h4>
    <p>${esc(t('txt_comm_info_tip_scope_desc'))}</p>
    <h4>${esc(t('txt_comm_info_tip_defaults_title'))}</h4>
    <p>${esc(t('txt_comm_info_tip_defaults_desc'))}</p>
    <h4>${esc(t('txt_comm_info_tip_reassign_title'))}</h4>
    <p>${esc(t('txt_comm_info_tip_reassign_desc'))}</p>
  `;
}

function _clubsInfoHtml() {
  return `
    <h3 id="format-info-heading">${esc(t('txt_clubs_info_panel_title'))}</h3>
    <p>${esc(t('txt_clubs_info_panel_subtitle'))}</p>
    <h4>${esc(t('txt_clubs_info_tip_upgrade_title'))}</h4>
    <p>${esc(t('txt_clubs_info_tip_upgrade_desc'))}</p>
    <h4>${esc(t('txt_clubs_info_tip_seasons_title'))}</h4>
    <p>${esc(t('txt_clubs_info_tip_seasons_desc'))}</p>
    <h4>${esc(t('txt_clubs_info_tip_roster_title'))}</h4>
    <p>${esc(t('txt_clubs_info_tip_roster_desc'))}</p>
  `;
}

function openContextInfo(scope) {
  const html = scope === 'clubs' ? _clubsInfoHtml() : _commInfoHtml();
  document.getElementById('format-info-content').innerHTML = html;
  document.getElementById('format-info-overlay').style.display = 'block';
  document.getElementById('format-info-dialog').style.display = 'block';
}

function _showToast(message, type) {
  if (!message) return;
  const isError = type === 'error';
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.top = '1rem';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = isError ? 'var(--danger, #d9534f)' : 'var(--green)';
  toast.style.color = '#fff';
  toast.style.padding = '0.7rem 1.2rem';
  toast.style.borderRadius = '8px';
  toast.style.fontWeight = '600';
  toast.style.fontSize = '0.9rem';
  toast.style.zIndex = '9999';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  toast.style.maxWidth = '90vw';
  toast.style.textAlign = 'center';
  document.body.appendChild(toast);
  const duration = isError ? 3000 : 1800;
  setTimeout(() => {
    toast.style.transition = 'opacity 0.2s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

// Backward-compatible alias for any accidental lowercase call sites.
function _showtoast(message) {
  _showToast(message);
}

// ─── Abbreviation legend popup ────────────────────────────────────────────────
let _abbrevPopupBtn = null;

function _buildAbbrevLegend(type) {
  const rows = type === 'standings' ? [
    [t('txt_txt_p_abbrev'),    t('txt_txt_abbrev_mp_full')],
    [t('txt_txt_w_abbrev'),    t('txt_txt_abbrev_w_full')],
    [t('txt_txt_d_abbrev'),    t('txt_txt_abbrev_d_full')],
    [t('txt_txt_l_abbrev'),    t('txt_txt_abbrev_l_full')],
    [t('txt_txt_sw_abbrev'),   t('txt_txt_abbrev_sw_full')],
    [t('txt_txt_sl_abbrev'),   t('txt_txt_abbrev_sl_full')],
    [t('txt_txt_sd_abbrev'),   t('txt_txt_abbrev_sd_full')],
    [t('txt_txt_pf_abbrev'),   t('txt_txt_abbrev_pf_full')],
    [t('txt_txt_pa_abbrev'),   t('txt_txt_abbrev_pa_full')],
    [t('txt_txt_diff_abbrev'), t('txt_txt_abbrev_diff_full')],
  ] : [
    [t('txt_txt_total_pts_abbrev'), t('txt_txt_abbrev_total_pts_full')],
    [t('txt_txt_played_abbrev'),    t('txt_txt_abbrev_played_full')],
    [t('txt_txt_w_abbrev'),         t('txt_txt_abbrev_w_full')],
    [t('txt_txt_d_abbrev'),         t('txt_txt_abbrev_d_full')],
    [t('txt_txt_l_abbrev'),         t('txt_txt_abbrev_l_full')],
    [t('txt_txt_avg_pts_abbrev'),   t('txt_txt_abbrev_avg_pts_full')],
    [t('txt_txt_buchholz_abbrev'),  t('txt_txt_abbrev_buchholz_full')],
  ];
  const tiebreakerKey = type === 'standings' ? 'txt_txt_abbrev_tiebreaker_standings' : 'txt_txt_abbrev_tiebreaker_leaderboard';
  const tiebreakerHtml = `<p style="margin:0.6rem 0 0;padding-top:0.5rem;border-top:1px solid var(--border);font-size:0.78rem;color:var(--text-muted)"><strong>${esc(t('txt_txt_abbrev_tiebreaker_title'))}</strong><br>${esc(t(tiebreakerKey))}</p>`;
  return `<table>${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>${tiebreakerHtml}`;
}

function showAbbrevPopup(event, type) {
  event.stopPropagation();
  const popup = document.getElementById('abbrev-popup');
  const btn = event.currentTarget;
  if (popup.style.display === 'block' && _abbrevPopupBtn === btn) {
    popup.style.display = 'none';
    _abbrevPopupBtn = null;
    return;
  }
  _abbrevPopupBtn = btn;
  popup.innerHTML = _buildAbbrevLegend(type);
  popup.style.display = 'block';
  const rect = btn.getBoundingClientRect();
  const pw = popup.offsetWidth || 210;
  const ph = popup.offsetHeight || 200;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - pw - 8));
  // Clamp vertically too — near the bottom of a phone screen the popup
  // would otherwise extend past the viewport with no way to scroll to it.
  const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - ph - 8));
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

document.addEventListener('click', (e) => {
  const p = document.getElementById('abbrev-popup');
  if (p && p.style.display === 'block' && !p.contains(e.target) && e.target !== _abbrevPopupBtn) {
    p.style.display = 'none';
    _abbrevPopupBtn = null;
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeFormatInfo();
    const p = document.getElementById('abbrev-popup');
    if (p) { p.style.display = 'none'; _abbrevPopupBtn = null; }
  }
});

function _gpFormatInfoHtml() {
  const s = _currentSport;
  return `
    <h3 id="format-info-heading">${t('txt_txt_fmt_gp_title')}</h3>
    <p>${ts('txt_txt_fmt_gp_intro', s)}</p>
    <div class="info-block">
      <strong>${ts('txt_txt_fmt_gp_team_mode_title', s)}</strong>
      <p>${ts('txt_txt_fmt_gp_team_mode_desc', s)}</p>
    </div>
    <div class="info-block">
      <strong>${ts('txt_txt_fmt_gp_player_mode_title', s)}</strong>
      <p>${ts('txt_txt_fmt_gp_player_mode_desc', s)}</p>
    </div>
    ${_playoffsInfoHtml()}`;
}

function _mexFormatInfoHtml() {
  const s = _currentSport;
  return `
    <h3 id="format-info-heading">${t('txt_txt_fmt_mex_title')}</h3>
    <p>${ts('txt_txt_fmt_mex_intro', s)}</p>
    <p>${ts('txt_txt_fmt_mex_rounds_desc', s)}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_mex_strength_title')}</strong>
      <p>${t('txt_txt_fmt_mex_strength_desc')}</p>
    </div>
    ${_playoffsInfoHtml()}`;
}

function _poFormatInfoHtml() {
  const s = _currentSport;
  return `
    <h3 id="format-info-heading">${t('txt_txt_fmt_po_title')}</h3>
    <p>${ts('txt_txt_fmt_po_intro', s)}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_playoffs_single_title')}</strong>
      <p>${t('txt_txt_fmt_playoffs_single_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_playoffs_double_title')}</strong>
      <p>${t('txt_txt_fmt_playoffs_double_desc')}</p>
    </div>
    ${_adminFeaturesInfoHtml()}`;
}

function _lobbyFormatInfoHtml() {
  return `
    <h3 id="format-info-heading">${t('txt_txt_fmt_lobby_title')}</h3>
    <p>${t('txt_txt_fmt_lobby_intro')}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_lobby_share_title')}</strong>
      <p>${t('txt_txt_fmt_lobby_share_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_lobby_join_code_title')}</strong>
      <p>${t('txt_txt_fmt_lobby_join_code_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_lobby_levels_title')}</strong>
      <p>${t('txt_txt_fmt_lobby_levels_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_lobby_convert_title')}</strong>
      <p>${t('txt_txt_fmt_lobby_convert_desc')}</p>
    </div>`;
}

function _playoffsInfoHtml() {
  return `
    <hr class="info-divider">
    <h3>${t('txt_txt_fmt_playoffs_title')}</h3>
    <p>${t('txt_txt_fmt_playoffs_intro')}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_playoffs_single_title')}</strong>
      <p>${t('txt_txt_fmt_playoffs_single_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_playoffs_double_title')}</strong>
      <p>${t('txt_txt_fmt_playoffs_double_desc')}</p>
    </div>
    ${_adminFeaturesInfoHtml()}`;
}

function _adminFeaturesInfoHtml() {
  return `
    <hr class="info-divider">
    <h3>${t('txt_txt_fmt_admin_title')}</h3>
    <p>${t('txt_txt_fmt_admin_intro')}</p>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_comments_title')}</strong>
      <p>${t('txt_txt_fmt_comments_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_player_login_title')}</strong>
      <p>${t('txt_txt_fmt_player_login_desc')}</p>
    </div>
    <div class="info-block">
      <strong>${t('txt_txt_fmt_banner_title')}</strong>
      <p>${t('txt_txt_fmt_banner_desc')}</p>
    </div>`;
}

function setTheme(theme) {
  const themeValue = _applyTheme(theme);
  _saveTheme(themeValue);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.textContent = themeValue === 'dark' ? '🌙' : '☀️';
    btn.title = t('txt_txt_toggle_light_dark_mode');
    btn.setAttribute('aria-label', themeValue === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('data-active-theme', themeValue);
  }
}

function initTheme() {
  const theme = _loadSavedTheme();
  _applyTheme(theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    btn.textContent = theme === 'dark' ? '🌙' : '☀️';
    btn.title = t('txt_txt_toggle_light_dark_mode');
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('data-active-theme', theme);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}

function setLanguage(lang) {
  setAppLanguage(lang);
  _refreshLanguageToggleButton();
  if (typeof rerenderClubsPanelOnLanguageChange === 'function') {
    rerenderClubsPanelOnLanguageChange();
  }
  _applySportToCreatePanel();
  updateActiveTournamentUI();
  updateAuthUI();
  renderParticipantFields('gp');
  renderParticipantFields('mex');
  renderParticipantFields('po');
  if (typeof _loadCommunities === 'function') _loadCommunities().then(() => {
    if (typeof _loadClubs === 'function') _loadClubs();
  });
  if (_currentCreateMode === 'lobby') showCreateRegistration();
  refreshCourtDefaults('gp');
  refreshCourtDefaults('mex');
  refreshCourtDefaults('po');
  if (_convertFromRegistration) _showConvertBanner();
  if (currentTid) {
    if (currentType === 'group_playoff') renderGP();
    else if (currentType === 'playoff') renderPO();
    else if (currentType === 'mexicano') renderMex();
    else if (currentType === 'registration') {
      const inConvertPanel = _convRid === currentTid && !!document.getElementById('conv-name');
      if (inConvertPanel) _renderConvertPanel(currentTid, true);
      else _renderRegDetailInline(currentTid);
    }
  } else {
    loadTournaments();
  }
}

function toggleLanguage() {
  setLanguage(getAppLanguage() === 'es' ? 'en' : 'es');
}

function _refreshLanguageToggleButton() {
  const btn = document.getElementById('lang-toggle-btn');
  if (!btn) return;
  const current = getAppLanguage();
  const currentLabel = current === 'es' ? t('txt_txt_spanish') : t('txt_txt_english');
  btn.textContent = current === 'es' ? '🇪🇸' : '🇬🇧';
  btn.title = `${t('txt_txt_language')}: ${currentLabel}`;
  btn.setAttribute('aria-label', `${t('txt_txt_language')}: ${currentLabel}`);
}

function initLanguageSelector() {
  initLanguage();
  _refreshLanguageToggleButton();
}

// ─── Page selector (Admin / TV / Registrations) ───────────
const PAGE_SELECTOR_KEY = 'amistoso-last-page';

function togglePageSelector() {
  togglePageSelectorDropdown();
}

function _closePageSelector() {
  const el = document.getElementById('page-selector');
  if (el) el.classList.remove('open');
}

function _initPageSelector() {
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const sel = document.getElementById('page-selector');
    if (sel && !sel.contains(e.target)) sel.classList.remove('open');
  });
  // Save current page as last visited
  try { localStorage.setItem(PAGE_SELECTOR_KEY, 'admin'); } catch (_) {}
  // Intercept clicks to save target page
  document.querySelectorAll('.page-selector-item').forEach(a => {
    a.addEventListener('click', () => {
      const page = a.getAttribute('data-page');
      if (page) {
        try { localStorage.setItem(PAGE_SELECTOR_KEY, page); } catch (_) {}
      }
    });
  });
  // Refresh pin indicators and pin button state
  _refreshAdminPinState();
}

function _refreshAdminPinState() {
  const homePage = getHomePage();
  const isPinned = homePage === 'admin';
  // Update pin indicators on menu items
  document.querySelectorAll('.page-selector-item').forEach(a => {
    const page = a.getAttribute('data-page');
    const label = a.querySelector('[data-i18n]');
    if (label) {
      // Remove existing pin indicator
      const existing = a.querySelector('.pin-indicator');
      if (existing) existing.remove();
      // Add pin indicator if this is the home page
      if (page === homePage) {
        const pin = document.createElement('span');
        pin.className = 'pin-indicator';
        pin.textContent = ' 📌';
        label.after(pin);
      }
    }
  });
  // Update the pin button
  const btn = document.getElementById('admin-pin-home-btn');
  if (btn) {
    const icon = btn.querySelector('.pin-icon');
    const label = btn.querySelector('.pin-label');
    if (icon) icon.textContent = isPinned ? '📌' : '📍';
    if (label) {
      label.textContent = isPinned ? t('txt_nav_unset_home') : t('txt_nav_set_home');
      label.setAttribute('data-i18n', isPinned ? 'txt_nav_unset_home' : 'txt_nav_set_home');
    }
  }
}

function _toggleAdminHomePin() {
  if (getHomePage() === 'admin') {
    clearHomePage();
  } else {
    setHomePage('admin');
  }
  _refreshAdminPinState();
}

// ─── Schema preview ────────────────────────────────────────

/** Debounce timer for the PO-creation auto-preview. */
let _poPreviewTimer = null;

/**
 * Schedule a PO bracket preview refresh with a short debounce.
 * Only fires if the po-preview-result container is visible (i.e. the PO
 * creation panel is active) and there are at least 2 participants.
 */
function _schedulePoPreview() {
  clearTimeout(_poPreviewTimer);
  _poPreviewTimer = setTimeout(() => {
    const panel = document.getElementById('create-panel-po');
    // Only auto-refresh when the PO panel is currently active
    if (!panel || !panel.classList.contains('active')) return;
    if (typeof generatePoPreviewSchema === 'function') generatePoPreviewSchema();
  }, 600);
}

/** Shared helper that powers all three schema download flows. */
async function _fetchSchema(prefix, apiUrl, defaultFilename) {
  const msg = document.getElementById(prefix + '-msg');
  const result = document.getElementById(prefix + '-result');
  if (!msg || !result) return;

  msg.classList.add('hidden');
  result.innerHTML = `<em>${t('txt_txt_generating')}</em>`;

  const fmt = document.getElementById(prefix + '-fmt').value;
  const boxScale = document.getElementById(prefix + '-box').value;
  const lineWidth = document.getElementById(prefix + '-lw').value;
  const arrowScale = document.getElementById(prefix + '-arrow').value;
  const titleFontScale = document.getElementById(prefix + '-title-scale')?.value || '1.0';
  const outputScale = document.getElementById(prefix + '-output-scale')?.value || '0.7';
  const title = document.getElementById(prefix + '-title').value.trim();

  let url = apiUrl + (apiUrl.includes('?') ? '&' : '?')
    + `fmt=${fmt}&box_scale=${boxScale}&line_width=${lineWidth}&arrow_scale=${arrowScale}&title_font_scale=${titleFontScale}&output_scale=${outputScale}`;
  if (title) url += `&title=${encodeURIComponent(title)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || t('txt_txt_failed_to_generate_schema'));
    }

    if (fmt === 'pdf') {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (title || defaultFilename) + '.pdf';
      a.click();
      result.innerHTML = `<em>${t('txt_txt_pdf_downloaded')}</em>`;
    } else if (fmt === 'svg') {
      // Inline the SVG, then strip its hardcoded width/height attributes and
      // tag it with .bracket-svg so the CSS fit-to-screen rules apply (the
      // backend emits explicit pixel dimensions that would otherwise overflow).
      result.innerHTML = await res.text();
      const svgEl = result.querySelector('svg');
      if (svgEl) {
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.classList.add('bracket-svg');
        // Allow tap/click to open the lightbox — serialize SVG back to a blob
        // URL so the shared _openBracketLightbox machinery works unchanged.
        svgEl.style.cursor = 'zoom-in';
        svgEl.title = t('txt_txt_click_to_expand');
        svgEl.addEventListener('click', () => {
          const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
          _openBracketLightbox(URL.createObjectURL(blob));
        });
      }
    } else {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      result.innerHTML = `<img src="${blobUrl}" class="bracket-img" alt="${t('txt_txt_schema')}" onclick="_openBracketLightbox('${blobUrl}')" title="${t('txt_txt_click_to_expand')}">`;
    }
  } catch (e) {
    result.innerHTML = '';
    msg.textContent = e.message;
    msg.classList.remove('hidden');
  }
}

function generateSchema() {
  const groups = document.getElementById('schema-groups').value.trim();
  const advance = document.getElementById('schema-advance').value;
  const elim = document.getElementById('schema-elim').value;
  const url = `/api/schema/preview?group_sizes=${encodeURIComponent(groups)}&advance_per_group=${advance}&elimination=${elim}`;
  _fetchSchema('schema', url, 'bracket');
}

const _SCHEMA_PRESETS = [
  { label: '2×4', groups: '4,4',     advance: 2, players: 8  },
  { label: '3×4', groups: '4,4,4',   advance: 2, players: 12 },
  { label: '4×4', groups: '4,4,4,4', advance: 2, players: 16 },
  { label: '2×6', groups: '6,6',     advance: 3, players: 12 },
  { label: '3×6', groups: '6,6,6',   advance: 2, players: 18 },
  { label: '4×6', groups: '6,6,6,6', advance: 2, players: 24 },
];

function _applySchemaPreset(label) {
  const preset = _SCHEMA_PRESETS.find(p => p.label === label);
  if (!preset) return;
  document.getElementById('schema-groups').value = preset.groups;
  document.getElementById('schema-advance').value = preset.advance;
  // Update active state on preset buttons
  document.querySelectorAll('.schema-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === label);
  });
  // Reset rendering sliders to defaults so the preview isn't skewed by a
  // previous session's manual tuning after clicking a preset.
  const defaults = { 'schema-box': '1.0', 'schema-lw': '1.0', 'schema-arrow': '1.0', 'schema-title-scale': '1.0', 'schema-output-scale': '0.7' };
  for (const [id, val] of Object.entries(defaults)) {
    const el = document.getElementById(id);
    if (el) {
      el.value = val;
      // Sync the displayed value label next to each slider
      const valLbl = document.getElementById(id + '-val');
      if (valLbl) valLbl.textContent = val;
    }
  }
  _updateSchemaSummary();
}

function _updateSchemaSummary() {
  const raw = document.getElementById('schema-groups').value.trim();
  const advance = parseInt(document.getElementById('schema-advance').value, 10);
  const elim = document.getElementById('schema-elim').value;
  const summaryEl = document.getElementById('schema-summary');
  if (!summaryEl) return;

  const groups = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
  if (!groups.length || isNaN(advance) || advance < 1) {
    summaryEl.textContent = '';
    // Deselect presets if user edited manually to non-matching value
    document.querySelectorAll('.schema-preset-btn').forEach(btn => btn.classList.remove('active'));
    return;
  }

  const totalPlayers = groups.reduce((a, b) => a + b, 0);
  const totalQualified = groups.length * advance;
  const elimLabel = elim === 'double' ? t('txt_txt_double_elimination') : t('txt_txt_single_elimination');

  // Group description: e.g. "3 × 4" if all same size, else "4+4+5"
  const allSame = groups.every(g => g === groups[0]);
  const groupDesc = allSame ? `${groups.length} × ${groups[0]}` : groups.join('+');

  summaryEl.textContent = `${groupDesc} = ${totalPlayers} ${t('txt_txt_players_lc')} · ${totalQualified} ${t('txt_txt_qualify')} → ${elimLabel}`;

  // Highlight matching preset if any
  const groupsStr = groups.join(',');
  const match = _SCHEMA_PRESETS.find(p => p.groups === groupsStr && p.advance === advance);
  document.querySelectorAll('.schema-preset-btn').forEach(btn => {
    btn.classList.toggle('active', !!match && btn.dataset.preset === match.label);
  });
}

// ─── Admin bracket plot driven by TV settings ──────────────
// The admin per-tournament view shows ONE bracket image whose rendering
// (format + box/line/arrow/header/output scales) follows the TV settings.
// This guarantees the public TV/spectator page and the admin preview stay
// in sync, so admins can tune readability and see the result everyone sees.

/**
 * Build the schema URL from a tvSettings object. Mirrors the URL
 * construction used by the public TV view (`tv.js`).
 */
function _adminBracketUrl(apiBase, tvSettings) {
  const s = tvSettings || {};
  const fmt = s.schema_format || 'svg';
  const bs  = s.schema_box_scale        ?? 1.0;
  const lw  = s.schema_line_width       ?? 1.0;
  const ar  = s.schema_arrow_scale      ?? 1.0;
  const tfs = s.schema_title_font_scale ?? 1.0;
  const os  = s.schema_output_scale     ?? 1.0;
  const params = `fmt=${fmt}&box_scale=${bs}&line_width=${lw}&arrow_scale=${ar}&title_font_scale=${tfs}&output_scale=${os}`;
  return `${apiBase}?${params}&_t=${Date.now()}`;
}

/**
 * Render the admin bracket card for a tournament view. Single source of
 * truth: any rendering tweak goes through TV settings, then this card
 * (and the public TV view) reflects it.
 */
function _renderAdminBracketCard(apiBase, tvSettings, opts = {}) {
  const title = opts.title || t('txt_txt_play_off_bracket');
  const isEspejo = opts.isEspejo === true;
  const isDouble = opts.isDouble === true;
  const useSplit = isEspejo || isDouble;
  const url = _adminBracketUrl(apiBase, tvSettings);
  let h = `<div class="card admin-bracket-card" data-bracket-api="${apiBase}" data-espejo="${isEspejo ? '1' : ''}" data-double="${isDouble ? '1' : ''}">`;
  h += `<div class="admin-bracket-header">`;
  h += `<h2 class="admin-bracket-title">${esc(title)}</h2>`;
  h += `<button type="button" class="btn btn-sm btn-muted" onclick="_jumpToSettings('tv')" title="${escAttr(t('txt_admin_bracket_open_settings_hint'))}">${_antIc('setting')} ${esc(t('txt_admin_bracket_tune_btn'))}</button>`;
  h += `</div>`;
  if (useSplit) {
    h += `<div class="espejo-brackets-row">`;
    h += `<div class="espejo-bracket-half">`;
    h += `<div class="espejo-bracket-label">${esc(t('txt_txt_espejo_winners_bracket'))}</div>`;
    h += `<div class="bracket-scroll-wrapper"><img id="admin-bracket-img" class="bracket-img" src="${url}&side=winners" alt="Winners" onclick="_openBracketLightbox(this.src)" title="${escAttr(t('txt_txt_click_to_expand'))}" onerror="this.style.display='none'"></div>`;
    h += `</div>`;
    h += `<div class="espejo-bracket-half">`;
    h += `<div class="espejo-bracket-label">${esc(t('txt_txt_espejo_losers_bracket'))}</div>`;
    h += `<div class="bracket-scroll-wrapper" id="admin-bracket-losers-wrap">` +
      `<img id="admin-bracket-img-losers" class="bracket-img" src="${url}&side=losers" alt="Losers"` +
      ` onclick="_openBracketLightbox(this.src)" title="${escAttr(t('txt_txt_click_to_expand'))}"`;
    if (isEspejo) {
      h += ` onerror="this.style.display='none';var p=document.getElementById('admin-bracket-losers-pending');if(p)p.style.display='flex'"`;
    } else {
      h += ` onerror="this.style.display='none'"`;
    }
    h += `>`;
    if (isEspejo) {
      h += `<div id="admin-bracket-losers-pending" style="display:none;align-items:center;justify-content:center;padding:1.5rem;color:var(--text-muted);font-size:0.84rem;text-align:center;border:1px dashed var(--border);border-radius:8px">${esc(t('txt_espejo_lb_pending'))}</div>`;
    }
    h += `</div>`;
    h += `</div>`;
    h += `</div>`;
  } else {
    h += `<div class="bracket-scroll-wrapper">`;
    h += `<img id="admin-bracket-img" class="bracket-img" src="${url}" alt="${escAttr(title)}" onclick="_openBracketLightbox(this.src)" title="${escAttr(t('txt_txt_click_to_expand'))}" onerror="this.style.display='none'">`;
    h += `</div>`;
  }
  h += `<p class="settings-help admin-bracket-hint">${esc(t('txt_admin_bracket_settings_hint'))}</p>`;
  h += `</div>`;
  return h;
}

/**
 * Refresh the admin bracket image's `src` from current DOM TV settings
 * controls so a slider/format change updates the preview immediately
 * without re-rendering the whole view (preserves drafts/scroll).
 */
function _refreshAdminBracketPreview() {
  const img = document.getElementById('admin-bracket-img');
  if (!img) return;
  const card = img.closest('.admin-bracket-card');
  if (!card) return;
  const apiBase = card.dataset.bracketApi;
  if (!apiBase) return;
  const num = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? +el.value : fallback;
  };
  const fmtEl = document.getElementById('tv-schema-format');
  const tvSettings = {
    schema_format:           fmtEl ? fmtEl.value : 'svg',
    schema_box_scale:        num('tv-schema-box',         1.0),
    schema_line_width:       num('tv-schema-lw',          1.0),
    schema_arrow_scale:      num('tv-schema-arrow',       1.0),
    schema_title_font_scale: num('tv-schema-title-scale', 1.0),
    schema_output_scale:     num('tv-schema-output',      1.0),
  };
  const isSplit = card.dataset.espejo === '1' || card.dataset.double === '1';
  img.style.display = '';
  img.src = _adminBracketUrl(apiBase, tvSettings) + (isSplit ? '&side=winners' : '');
  // For split brackets (espejo or DE): refresh the losers bracket image too.
  const losersImg = document.getElementById('admin-bracket-img-losers');
  if (losersImg && isSplit) {
    losersImg.style.opacity = '1';
    losersImg.src = _adminBracketUrl(apiBase, tvSettings) + '&side=losers';
  }
  // Keep schema builder sliders in sync with TV settings so both preview
  // surfaces always reflect the same rendering configuration.
  _syncSchemaBuilderFromTvSettings(tvSettings);
}

/**
 * Copy the current TV rendering settings into the Info-tab schema builder
 * sliders so the two preview surfaces stay in sync.
 * Only updates inputs that exist (builder may not be loaded yet).
 */
function _syncSchemaBuilderFromTvSettings(tvSettings) {
  const s = tvSettings || {};
  const pairs = [
    ['schema-fmt',          s.schema_format,           null],
    ['schema-box',          s.schema_box_scale,        'schema-box-val'],
    ['schema-lw',           s.schema_line_width,       'schema-lw-val'],
    ['schema-arrow',        s.schema_arrow_scale,      'schema-arrow-val'],
    ['schema-title-scale',  s.schema_title_font_scale, 'schema-title-scale-val'],
    ['schema-output-scale', s.schema_output_scale,     'schema-output-scale-val'],
  ];
  for (const [id, val, lblId] of pairs) {
    if (val === undefined || val === null) continue;
    const el = document.getElementById(id);
    if (!el) continue;
    el.value = val;
    if (lblId) {
      const lbl = document.getElementById(lblId);
      if (lbl) lbl.textContent = typeof val === 'number' ? val.toFixed(1) : val;
    }
  }
}

async function generatePoPreviewSchema() {
  const names = getParticipantNames('po');
  const resultEl = document.getElementById('po-preview-result');
  const msgEl = document.getElementById('po-preview-msg');
  msgEl.classList.add('hidden');
  if (typeof _updatePoMatchEstimate === 'function') _updatePoMatchEstimate();
  if (names.length < 2) {
    resultEl.innerHTML = '';
    return;
  }
  resultEl.innerHTML = `<em>${t('txt_txt_generating')}</em>`;
  try {
    const isEspejo = document.getElementById('po-espejo')?.checked || false;
    const elim = (!isEspejo && document.getElementById('po-double-elim').checked) ? 'double' : 'single';
    // Read rendering options from the schema builder sliders if present.
    const numOpt = (id, fallback) => {
      const el = document.getElementById(id);
      return el ? +el.value : fallback;
    };
    const fmt         = document.getElementById('schema-fmt')?.value || 'png';
    const boxScale    = numOpt('schema-box',          1.0);
    const lineWidth   = numOpt('schema-lw',           1.0);
    const arrowScale  = numOpt('schema-arrow',        1.0);
    const titleScale  = numOpt('schema-title-scale',  1.0);
    const outputScale = numOpt('schema-output-scale', 0.7);
    const title       = document.getElementById('schema-title')?.value?.trim() || '';

    const _buildParams = (participantNames, extraTitle) => {
      const p = new URLSearchParams({
        participants: participantNames.length,
        elimination: 'single',
        fmt,
        box_scale: boxScale,
        line_width: lineWidth,
        arrow_scale: arrowScale,
        title_font_scale: titleScale,
        output_scale: outputScale,
      });
      const t_ = extraTitle || title;
      if (t_) p.set('title', t_);
      for (const n of participantNames) p.append('names', n);
      return p;
    };

    if (isEspejo) {
      // Espejo preview: winners bracket with real names, losers bracket with
      // anonymous "Loser N" seeds — we don't know the R1 losers yet.
      const wbNames = names;
      const lbCount = Math.floor(names.length / 2);
      // Anonymous loser seeds for the LB structural preview.
      const lbNames = Array.from({ length: lbCount }, (_, i) => `Loser ${i + 1}`);

      const wbUrl = `/api/schema/playoff-preview?${_buildParams(wbNames, title || t('txt_txt_espejo_winners_bracket'))}`;

      let wbHtml = '', lbHtml = '';

      // Fetch WB always; only fetch LB when there are ≥2 losers to show.
      const fetchWb = fetch(wbUrl);
      const fetchLb = lbCount >= 2 ? fetch(`/api/schema/playoff-preview?${_buildParams(lbNames, t('txt_txt_espejo_losers_bracket'))}`) : null;
      const [wbRes, lbRes] = await Promise.all([fetchWb, fetchLb || Promise.resolve(null)]);

      if (!wbRes.ok) throw new Error((await wbRes.json().catch(() => ({}))).detail || 'Error');
      if (lbRes && !lbRes.ok) throw new Error((await lbRes.json().catch(() => ({}))).detail || 'Error');

      const _renderBracketResponse = async (res, altText) => {
        if (!res) return `<p class="settings-help" style="margin:0.5rem 0">${t('txt_txt_espejo_approx_losers')}: ${t('txt_txt_need_at_least_2_participants')}</p>`;
        if (fmt === 'svg') {
          const wrap = document.createElement('div');
          wrap.innerHTML = await res.text();
          const svgEl = wrap.querySelector('svg');
          if (svgEl) {
            svgEl.removeAttribute('width'); svgEl.removeAttribute('height');
            svgEl.classList.add('bracket-svg');
            svgEl.style.cursor = 'zoom-in';
            svgEl.title = t('txt_txt_click_to_expand');
            svgEl.addEventListener('click', () => {
              const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
              _openBracketLightbox(URL.createObjectURL(blob));
            });
          }
          return wrap.innerHTML;
        } else {
          const blobUrl = URL.createObjectURL(await res.blob());
          return `<img class="bracket-img" src="${blobUrl}" alt="${escAttr(altText)}" onclick="_openBracketLightbox('${blobUrl}')" title="${t('txt_txt_click_to_expand')}">`;
        }
      };

      wbHtml = await _renderBracketResponse(wbRes, t('txt_txt_espejo_winners_bracket'));
      lbHtml = await _renderBracketResponse(lbRes, t('txt_txt_espejo_losers_bracket'));

      resultEl.innerHTML =
        `<div class="espejo-brackets-row">` +
        `<div class="espejo-bracket-half"><div class="espejo-bracket-label">${esc(t('txt_txt_espejo_winners_bracket'))}</div>${wbHtml}</div>` +
        `<div class="espejo-bracket-half"><div class="espejo-bracket-label">${esc(t('txt_txt_espejo_losers_bracket'))}${lbCount >= 2 ? ` <small style="font-weight:400;text-transform:none;letter-spacing:0">(~${lbCount} ${t('txt_txt_espejo_approx_losers')})</small>` : ''}</div>${lbHtml}</div>` +
        `</div>`;
      return;
    }

    const params = _buildParams(names, title);
    params.set('elimination', elim);
    const url = `/api/schema/playoff-preview?${params}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Error');

    if (fmt === 'pdf') {
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (title || 'bracket') + '.pdf';
      a.click();
      resultEl.innerHTML = `<em>${t('txt_txt_pdf_downloaded')}</em>`;
    } else if (fmt === 'svg') {
      resultEl.innerHTML = await res.text();
      const svgEl = resultEl.querySelector('svg');
      if (svgEl) {
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.classList.add('bracket-svg');
        svgEl.style.cursor = 'zoom-in';
        svgEl.title = t('txt_txt_click_to_expand');
        svgEl.addEventListener('click', () => {
          const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
          _openBracketLightbox(URL.createObjectURL(blob));
        });
      }
    } else {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      resultEl.innerHTML = `<details class="bracket-collapse bracket-collapse-left" open><summary class="bracket-collapse-summary"><span class="bracket-chevron bracket-chevron-anim">&#9654;</span>${t('txt_txt_play_off_bracket')}</summary><img class="bracket-img" src="${blobUrl}" alt="${t('txt_txt_play_off_bracket')}" onclick="_openBracketLightbox('${blobUrl}')" title="${t('txt_txt_click_to_expand')}"></details>`;
    }
  } catch (e) {
    resultEl.innerHTML = '';
    msgEl.textContent = e.message;
    msgEl.classList.remove('hidden');
  }
}

// Removed `_schemaCardHtml` + `generate{Gp,Mex,Po}PlayoffSchema` (2026-04-30):
// the per-tournament admin views now render a single bracket plot via
// `_renderAdminBracketCard`, driven by TV settings, so the schema is always
// in sync with what the public TV/spectator page shows.

// ─── API helper ────────────────────────────────────────────
// Use authenticated API wrapper from auth.js

// ─── Language toggle (shared between registration & player codes) ──────────

/**
 * Render a compact EN/ES segmented toggle for email language.
 * @param {string} parentId - registration or tournament id
 * @param {string} playerId - player identifier
 * @param {string} currentLang - current lang value ('en' or 'es')
 * @param {string} context - 'reg' for registrants, 'sec' for player_secrets
 */
function _langToggle(parentId, playerId, currentLang, context) {
  const isEn = currentLang === 'en';
  const btnBase = 'display:inline-block;padding:0.08rem 0.35rem;font-size:0.7rem;font-weight:600;cursor:pointer;border:1px solid var(--border);line-height:1.3;';
  const activeStyle = 'background:var(--accent);color:#fff;border-color:var(--accent);';
  const inactiveStyle = 'background:var(--surface);color:var(--text-muted);';
  const enStyle = btnBase + (isEn ? activeStyle : inactiveStyle) + 'border-radius:4px 0 0 4px;border-right:none;';
  const esStyle = btnBase + (!isEn ? activeStyle : inactiveStyle) + 'border-radius:0 4px 4px 0;';
  const handler = context === 'reg' ? '_setRegLang' : '_setSecLang';
  return `<span style="display:inline-flex;white-space:nowrap">`
    + `<span style="${enStyle}" onclick="${handler}('${esc(parentId)}','${esc(playerId)}','en',this.parentElement)" title="${t('txt_txt_english')}">EN</span>`
    + `<span style="${esStyle}" onclick="${handler}('${esc(parentId)}','${esc(playerId)}','es',this.parentElement)" title="${t('txt_txt_spanish')}">ES</span>`
    + `</span>`;
}

/** Update a player_secrets lang preference (tournament context). */
async function _setSecLang(tid, pid, lang, toggleEl) {
  try {
    await api(`/api/tournaments/${tid}/player-secrets/${pid}/lang`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang }),
    });
    if (toggleEl) {
      toggleEl.outerHTML = _langToggle(tid, pid, lang, 'sec');
    }
    // Update local cache
    if (_playerSecrets && _playerSecrets[pid]) _playerSecrets[pid].lang = lang;
  } catch (e) { console.error('Failed to update player lang:', e.message); }
}

// ─── Admin toast / undo snackbar (#5) ─────────────────────────────────────
let _adminToastSeq = 0;

/**
 * Show an ephemeral snackbar at the bottom of the screen.
 *
 * @param {string} msg                 Message text to display.
 * @param {object} [opts]
 * @param {Function} [opts.onUndo]     If provided, an "Undo" button is shown.
 *                                     Click handler triggers this then closes.
 * @param {number}   [opts.duration]   ms before auto-dismiss (default 6000).
 */
function _showAdminToast(msg, opts = {}) {
  let stack = document.getElementById('admin-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'admin-toast-stack';
    stack.className = 'admin-toast-stack';
    document.body.appendChild(stack);
  }
  const id = `admin-toast-${++_adminToastSeq}`;
  const toast = document.createElement('div');
  toast.className = 'admin-toast';
  toast.id = id;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const msgSpan = document.createElement('span');
  msgSpan.className = 'admin-toast-msg';
  msgSpan.textContent = msg;
  toast.appendChild(msgSpan);

  if (typeof opts.onUndo === 'function') {
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'admin-toast-undo';
    undoBtn.textContent = t('txt_admin_undo');
    undoBtn.onclick = async () => {
      _dismissAdminToast(id);
      try { await opts.onUndo(); } catch (e) { console.error('Undo failed:', e); }
    };
    toast.appendChild(undoBtn);
  }
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'admin-toast-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  closeBtn.onclick = () => _dismissAdminToast(id);
  toast.appendChild(closeBtn);
  stack.appendChild(toast);

  const duration = opts.duration ?? 6000;
  if (duration > 0) {
    setTimeout(() => _dismissAdminToast(id), duration);
  }
  return id;
}

function _dismissAdminToast(id) {
  const el = document.getElementById(id);
  if (!el || el.classList.contains('is-leaving')) return;
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 220);
}

// ─── In-memory activity drawer (#19) ──────────────────────────────────────
const _ADMIN_ACTIVITY_MAX = 30;
const _adminActivityLog = [];

/**
 * Record an admin action so it shows up in the activity drawer. Pure
 * frontend / in-memory — cleared on full page reload.
 */
function _recordActivity(label) {
  if (!label) return;
  _adminActivityLog.unshift({ label: String(label), ts: Date.now() });
  if (_adminActivityLog.length > _ADMIN_ACTIVITY_MAX) _adminActivityLog.length = _ADMIN_ACTIVITY_MAX;
}

function _formatActivityTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}

// ─── Unified match filter (#6) ────────────────────────────────────────────
// Filter chip row applied to .match-card-wrap globally. Persisted per
// tournament in sessionStorage so reloads inside the same tab keep the
// admin's choice. Possible values: 'all' | 'pending' | 'completed' | 'disputed'.
const _MATCH_FILTER_VALUES = new Set(['all', 'pending', 'completed', 'disputed']);

function _matchFilterStorageKey(tid) {
  return `adminMatchFilter:${tid}`;
}

function _readPersistedMatchFilter(tid) {
  if (!tid) return 'all';
  try {
    const v = sessionStorage.getItem(_matchFilterStorageKey(tid));
    return _MATCH_FILTER_VALUES.has(v) ? v : 'all';
  } catch (_) { return 'all'; }
}

function _persistMatchFilter(tid, value) {
  if (!tid) return;
  try { sessionStorage.setItem(_matchFilterStorageKey(tid), value); } catch (_) { /* ignore */ }
}

/**
 * Render the unified match filter chip row. Rendered inside the status bar.
 * The disputed chip only appears when score confirmation is non-immediate
 * (the only context where disputes can exist).
 */
function _renderMatchFilterChips(tid) {
  const current = _readPersistedMatchFilter(tid);
  // _gpMatchFilterState is the legacy global used by _applyMatchFilter; keep in sync.
  if (typeof _gpMatchFilterState !== 'undefined') _gpMatchFilterState = current;
  const showDisputed = (typeof _scoreConfirmationMode !== 'undefined') && _scoreConfirmationMode !== 'immediate';
  const chip = (key, label) => {
    const active = current === key ? ' active' : '';
    return `<button type="button" class="${active}" data-filter="${key}" onclick="_applyMatchFilter('${key}')">${esc(label)}</button>`;
  };
  let html = `<div class="match-filter-row" id="admin-match-filter-row" role="tablist" aria-label="Match filter">`;
  html += `<div class="match-filter-toggle" id="gp-match-filter">`;
  html += chip('all', t('txt_txt_filter_all'));
  html += chip('pending', t('txt_txt_filter_pending'));
  html += chip('completed', t('txt_txt_filter_completed'));
  if (showDisputed) html += chip('disputed', t('txt_admin_filter_disputed'));
  html += `</div></div>`;
  return html;
}

// ─── Status-bar attention badge (#3) ──────────────────────────────────────
/**
 * Build the attention area inside the status bar. When there are review
 * items (disputes / pending confirmation), collapse the four pending stat
 * pills into one warning button that scrolls to the review queue. Other
 * stat pills are only emitted when their value is non-zero.
 *
 * @param {object} stats          From `_buildGpOpsStats` / `_buildMexOpsStats`.
 * @param {string} reviewCardId   DOM id of the review queue card to scroll to.
 */
function _renderStatusBarStats(stats, reviewCardId) {
  const reviewItems = (stats.disputesCount || 0) + (stats.pendingConfirmationCount || 0);
  let html = `<div class="gp-ops-stats-row">`;
  if (reviewItems > 0 && reviewCardId) {
    const label = reviewItems === 1
      ? t('txt_admin_status_attention_one')
      : t('txt_admin_status_attention', { n: reviewItems });
    html += `<button type="button" class="gp-ops-attention" onclick="document.getElementById('${reviewCardId}')?.scrollIntoView({behavior:'smooth', block:'center'})">`;
    html += `<span class="gp-ops-attention-icon" aria-hidden="true">${_antIc('warning')}</span>${esc(label)}`;
    html += `</button>`;
  }
  if (stats.unresolvedCount > 0) {
    html += `<div class="gp-ops-stat-pill"><span>${t('txt_txt_pending_matches')}</span><strong>${stats.unresolvedCount}</strong></div>`;
  }
  if (stats.unassignedCourtsCount > 0) {
    html += `<div class="gp-ops-stat-pill"><span>${t('txt_txt_no_courts')}</span><strong>${stats.unassignedCourtsCount}</strong></div>`;
  }
  if (stats.escalatedCount > 0) {
    html += `<div class="gp-ops-stat-pill"><span>${t('txt_txt_escalated')}</span><strong>${stats.escalatedCount}</strong></div>`;
  }
  if (stats.totalMatchCount > 0) {
    html += `<div class="gp-ops-stat-pill"><span>${t('txt_txt_matches')}</span><strong>${stats.completedMatchCount}/${stats.totalMatchCount}</strong></div>`;
  }
  html += `</div>`;
  return html;
}

/**
 * Build the disabled-with-reason attribute string for a decision button.
 * Returns either ` disabled title="..."` (when reason provided) or empty.
 */
function _decisionDisabledAttrs(reason) {
  if (!reason) return '';
  return ` disabled title="${escAttr(reason)}" aria-disabled="true"`;
}

/**
 * Pick the reason a "next round / start playoffs" button should be disabled,
 * or null if the action is currently allowed.
 */
function _decisionDisabledReason({ pendingMatches = 0, finished = false, hasMoreRounds = true } = {}) {
  if (finished) return t('txt_admin_decision_disabled_finished');
  if (pendingMatches > 0) {
    return t('txt_admin_decision_disabled_pending', { n: pendingMatches });
  }
  if (!hasMoreRounds) return t('txt_admin_decision_disabled_no_more_rounds');
  return null;
}

/**
 * Themed replacement for window.confirm() — same look as the
 * delete-tournament modal (.modal-overlay / .modal-dialog / .modal-actions).
 *
 * @param {string}  message        Question shown to the user (plain text).
 * @param {object}  [opts]
 * @param {boolean} [opts.danger]  Style the confirm button as destructive.
 * @param {string}  [opts.title]   Optional dialog title.
 * @param {string}  [opts.confirmLabel] Confirm button label (defaults to
 *                                 Delete for danger, Confirm otherwise).
 * @returns {Promise<boolean>} true when confirmed, false otherwise.
 */
function uiConfirm(message, opts = {}) {
  if (typeof document === 'undefined' || !document.body) {
    return Promise.resolve(window.confirm(message));
  }
  const danger = !!opts.danger;
  const confirmLabel = opts.confirmLabel || t(danger ? 'txt_txt_delete' : 'txt_txt_confirm_score');
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog modal-md ui-confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleHtml = opts.title
      ? `<div class="modal-header"><h2 class="modal-title">${esc(opts.title)}</h2></div>`
      : '';
    dialog.innerHTML = `
      ${titleHtml}
      <p class="ui-confirm-message">${esc(message)}</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-muted" data-action="cancel">${esc(t('txt_txt_cancel'))}</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">${esc(confirmLabel)}</button>
      </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let resolved = false;
    function finish(result) {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(result);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') finish(false);
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', ev => { if (ev.target === overlay) finish(false); });
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
    dialog.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(true));
    // Focus the safe action first so Enter doesn't accidentally destroy.
    dialog.querySelector('[data-action="cancel"]').focus();
  });
}
