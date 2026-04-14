## v1.7.1 (2026-04-15)

### Fix

- **elo**: allow historical re-calculation

## v1.7.0 (2026-04-15)

### Feat

- **player-hub,-tennis-tournaments**: create live ELO rating system; allow doubles in tennis

## v1.6.4 (2026-04-14)

### Fix

- **frontend**: fix player hub history names alignment, fix admin panel

## v1.6.3 (2026-04-14)

### Fix

- **frontend**: fixes in admin and hub panels

## v1.6.2 (2026-04-14)

### Fix

- **frontend**: fix loading older mexicano tournaments; improve admin tournament creation frontend with linking Hub players; improve matches history frontend in Hub

## v1.6.1 (2026-04-13)

### Fix

- **mexicano**: allow loading older format of tournaments

## v1.6.0 (2026-04-13)

### Feat

- **players-path,-frontend**: add play off stats to players path; separate group stage and play offs in general stats; add a pin for a home page; fix scores mofifiers based on teams balance

## v1.5.4 (2026-04-12)

### Fix

- **tests**: fix email test

## v1.5.3 (2026-04-12)

### Fix

- **tests**: fix email verification test

## v1.5.2 (2026-04-12)

### Fix

- **email-verification**: fix frontend

## v1.5.1 (2026-04-12)

### Fix

- **tests**: fix email verification test rate limiter

## v1.5.0 (2026-04-12)

### Feat

- **player-hub**: add email verification; frontend enhancements; add a tournament path feature

## v1.4.1 (2026-04-11)

### Fix

- **public-links**: use uuids for tournaments and registrations links to avoid collisions

## v1.4.0 (2026-04-11)

### Feat

- **player-hub**: improve login screen; add a possibility to unlink tournaments; add an admin panel to manage players

## v1.3.7 (2026-04-10)

### Fix

- **tournament-creation**: don't reuse deleted tournaments ids

## v1.3.6 (2026-04-10)

### Fix

- **registration-conversion**: fix showing deleted tournaments

## v1.3.5 (2026-04-10)

### Fix

- **registration-conversion**: do not show tournaments that were deleted

## v1.3.4 (2026-04-10)

### Fix

- **registration-convertion**: propose 1st round in mexicano instead of starting automatically

## v1.3.3 (2026-04-10)

### Fix

- **player-hub-login**: rename button

## v1.3.2 (2026-04-10)

### Fix

- **admin-panel**: set 20s automatic polling for changed results

## v1.3.1 (2026-04-10)

### Fix

- **tv-view**: fix live updates

## v1.3.0 (2026-04-10)

### Feat

- **tv-mode**: introduce notification system; multiple frontend-related fixes

## v1.2.3 (2026-04-10)

### Fix

- **mexicano**: propose the 1st round instead of generating automatically

## v1.2.2 (2026-04-10)

### Fix

- **player-hub**: resolve tournaments aliases

## v1.2.1 (2026-04-10)

### Fix

- **info**: fix translation into spanish

## v1.2.0 (2026-04-10)

### Feat

- **Player-Hub**: introduce player profile connecting all tournaments registrations into one space; calculate stats over match history; fix team mode creation; imrpove frontend

## v1.1.0 (2026-04-07)

### Feat

- **players'-score-submission**: add score accept/reject logic handled by players

## v1.0.1 (2026-04-07)

### Fix

- **tv-frontend**: make pending matches collapsible by group

## v1.0.0 (2026-04-06)

### Overview

- **multi-format tournaments**: Group + Play-off, Mexicano, and Direct Play-offs with support for both Padel and Tennis scoring modes
- **registration workflow**: public sign-up lobbies with custom questionnaires, admin review tools, and one-click conversion into live tournaments
- **live operations**: TV/public view, configurable auto-refresh and section visibility, aliases, match comments, and broadcast banner messaging
- **player self-service**: passphrase + QR login, self-scoring controls, player code management, and per-player contact/email data
- **email communications**: optional SMTP-based credentials delivery, organizer announcements, round schedule notifications, and final-results emails for players with stored addresses
- **collaboration & security**: co-editors for tournaments/registrations, role-based access controls, JWT auth, and password-reset-by-email flow
- **in-tournament flexibility**: mid-tournament roster updates (supported formats), advanced Mexicano pairing/balancing settings, and playoff schema/export tooling
- **seeding logic**: playoff seeding reflects competitive phase results (group placement + tie-breakers, Mexicano leaderboard), with group-diversity-aware first-round pairing where possible

### Feat

- **collaboration**: add co-editors for tournaments and registration lobbies, with owner/admin-only share/delete management
- **auth**: add password reset by email flow (`/api/auth/forgot-password` + `/api/auth/reset-password/{token}`)
- **tournaments**: support mid-tournament roster updates (add players in active Mexicano and Group+Playoff group stage; remove players in active Mexicano with pending-match safeguards)
- **player-communications**: support player contact/email fields and organizer email notifications (round updates, announcements, final results) when SMTP is configured

### Docs

- **readme/admin-info**: document collaboration, password-reset, roster-update, and email communication capabilities

## v0.8.0 (2026-04-06)

### Feat

- **mexicano**: improve matches balancing logic

## v0.7.3 (2026-04-01)

### Fix

- **registrations,-play-offs**: add collaborators to registrations, fix redirects; fix double elimination tournaments logic

## v0.7.2 (2026-04-01)

Fix frontend on a group stage

## v0.7.1 (2026-04-01)

### Fix

- **group-stage**: fix scores computation for sets

## v0.7.0 (2026-03-31)

### Feat

- **group-stage**: add a player after the registragion phase is finished

## v0.6.2 (2026-03-31)

### Fix

- **mexicano-manual-match**: improve override interface

## v0.6.1 (2026-03-31)

### Fix

- **logo**: update android logo

## v0.6.0 (2026-03-31)

### Feat

- **admin-interface**: add sharing functionality; add password reset

## v0.5.1 (2026-03-29)

### Feat

- **registration form**: improve interface

## v0.5.0 (2026-03-29)

### Feat

- **registration**: add multiple choice to forms; add email support

## v0.4.1 (2026-03-28)

### Fix

- **players-registration**: remove and edit players from admin interface

## v0.4.0 (2026-03-27)

### Feat

- **registration**: registration flow

## v0.3.0 (2026-03-26)

### Feat

- **Answering-question-in-the-registration-form----admin-and-participants-displays**: view and edit questions in admin interface, frontend improvements

## v0.3.0-alpha (2026-03-26)

### Fix

- use /tv redirect path instead of /public.html in QR code URLs
