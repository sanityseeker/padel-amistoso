## v3.6.0 (2026-11-13)

### Feat

- court preferences, live court tracking and highlighted group places

## v3.5.4 (2026-11-13)

### Fix

- fit settings drawers on phones and let organizers hide the schedule from players

## v3.5.3 (2026-11-12)

### Fix

- charge lobby fees only to registrants who pass the participant filter

## v3.5.2 (2026-11-12)

### Fix

- let organizers send player messages by push notification instead of email

## v3.5.1 (2026-11-12)

### Fix

- hide page titles the active navigation item already shows

## v3.5.0 (2026-11-12)

### Feat

- scope leaderboard history to club/community/sport, add paid-for-others payments and zoomable bracket images

## v3.4.0 (2026-11-12)

### Feat

- **standings**: keep P on phones, explain W–L in the TV legend, match Russian descriptions to abbreviations
- **lobbies**: let an organizer clear the recent answer changes
- **lobbies**: keep answer changes "seen" per organizer on the server
- **player**: clearer recent rating trend chart
- **tv**: show the player card's matches from the player's side
- **standings**: show one W–L record column on phones

### Fix

- **api**: iterate a snapshot of the in-memory tournaments
- **lobbies**: keep the answers tab name free of the unseen count label
- **api**: iterate a snapshot of the in-memory tournaments
- **lobbies**: wrap the lobby settings tabs on phones
- **theme**: keep field text at 16 px on touch screens
- **standings**: line number column headers up with their values
- tell recipients when replies are not read

## v3.3.0 (2026-11-12)

### Feat

- send email through Resend API with SMTP fallback and batch sending

## v3.2.3 (2026-11-11)

### Fix

- commit pending frontend and backend changes

## v3.2.2 (2026-11-10)

### Fix

- **e2e**: align player header menu assertion

## v3.2.1 (2026-11-10)

### Fix

- **ci**: format TV E2E spec

## v3.2.0 (2026-11-10)

### Feat

- track registration answer changes and customize TV info

## v3.1.0 (2026-11-10)

### Feat

- **player**: mobile-first Player Hub, header and event page

### Fix

- **ci**: make the creation rate limit configurable, lift it for e2e
- keep an emptied Review tab open; steady Hub cards on scope change

## v3.0.2 (2026-11-09)

### Fix

- count stage progress on the server and add a standings toggle

## v3.0.1 (2026-11-09)

### Fix

- **e2e**: wait for form remount before typing in browser tests

## v3.0.0 (2026-11-09)

### BREAKING CHANGE

- the admin UI moved from /admin#/... hash routes to
/admin/... paths (old hash links are migrated at boot). The public
pages moved under /events, /player, /tv, /register and /club, and the
old UI is only available at /legacy/*. Bookmarks, QR codes and printed
links to old paths may need to be regenerated.

### Feat

- redesign frontend as React + Mantine SPA

## v2.4.2 (2026-11-06)

### Feat

- withdraw participants mid-tournament (50% rule)

### Fix

- **bracket**: keep long participant names inside their boxes

## v2.4.1 (2026-11-06)

### Fix

- **admin**: keep sticky group/round nav on one row

## v2.4.0 (2026-11-06)

### Feat

- **admin**: tighter, better-aligned mobile layout for tournament admin

### Fix

- **export**: player headers for individual tennis group stages

## v2.3.4 (2026-11-05)

### Fix

- **i18n**: correct group standings tie-breaker legend

## v2.3.3 (2026-11-05)

### Fix

- **admin**: consistent club ELO, clear match result, compact standings and settings tabs

## v2.3.2 (2026-11-05)

### Fix

- **admin**: keep scroll position across re-renders and tidy export/registration views

## v2.3.1 (2026-11-05)

### Fix

- **export**: player headers for individual matches, drop settings section
- **export**: uniform group table widths, omit court column without courts

## v2.3.0 (2026-11-05)

### Feat

- **playoffs**: per-bracket external participants in Oro/Plata split

## v2.2.0 (2026-11-05)

### Feat

- **playoffs**: Oro/Plata split Espejo with independent Gold and Silver brackets

## v2.1.2 (2026-11-04)

### Fix

- **clubs**: show club ratings on club tournament pages, redirect unknown clubs

## v2.1.1 (2026-11-04)

### Fix

- **clubs**: keep new events in their club's community, tidy club admin UI

## v2.1.0 (2026-11-04)

### Feat

- **elo**: give each club its own rating chain, add club ELO recalculation, hide Player Hub on demo

### Fix

- **admin**: limit club event suggestions to the club's community, add ghost merge, quieter player rows

## v2.0.0 (2026-11-03)

### BREAKING CHANGE

- GET /api/admin/player-profiles/unlinked/{tid} is removed;
use GET /api/admin/player-profiles/participants/{tid}, which returns every
participant with profile_id / profile_name / is_ghost.

### Feat

- recalculate ELO on every Hub link change, add Hub-profile merge, refresh admin UI

## v1.20.2 (2026-11-03)

### Fix

- **scoring**: lock player score entry to the match format; off-format scores go to organiser review

## v1.20.1 (2026-11-03)

### Fix

- **ui**: unify public header and page width; add multi-winner playoffs

## v1.20.0 (2026-11-03)

### Feat

- **ui**: unify public Events page, club-scoped navigation and mobile admin polish

## v1.19.1 (2026-11-02)

### Fix

- **playoffs**: make Espejo a consolation bracket and drop the Super Final

## v1.19.0 (2026-11-01)

## v1.18.0 (2026-11-01)

### Feat

- add payments tracking, per-match set format override, and registration notes

## v1.17.0 (2026-10-06)

### Feat

- **clubs**: make club leaderboard members-only
- **player-hub**: make ELO leaderboard members-only

## v1.16.2 (2026-07-21)

### Fix

- **player-hub**: fix merged players stats

## v1.16.1 (2026-07-20)

### Fix

- **elo**: fix elo recalculation accross tournaments

## v1.16.0 (2026-07-20)

### Feat

- **admin-ux**: refine ux; fix elo calculation for returning players; fix merging players profiles
- streamline admin login UX and trim verbose interface copy

## v1.15.0 (2026-07-13)


### Feat

- **registration**: settings page, participant filter, and filtered messaging

### Refactor

- **registration**: status dots instead of tick/cross eligibility marks

## v1.14.11 (2026-07-13)

### Fix

- **performance**: optimize db connections

## v1.14.10 (2026-07-13)

### Fix

- **registration**: improve the wording for returning players

## v1.14.9 (2026-07-11)

### Fix

- **nginx**: fix nginx configuration

## v1.14.8 (2026-07-11)

### Fix

- **readability**: improve documentation

## v1.14.7 (2026-07-11)

### Fix

- **front**: improve caching

## v1.14.6 (2026-07-11)

### Fix

- **demo-mode**: add nginx file

## v1.14.5 (2026-07-11)

## v1.14.4 (2026-07-11)

### Fix

- **registration-claims**: fix admin view on claiming the account during the registration

## v1.14.3 (2026-07-11)

### Fix

- **frontend**: improve admin frontend, fix minor flaws (e.g. overflow on submit button during teams selection)

## v1.14.2 (2026-07-10)

### Fix

- **database**: optimize calls to a database; remove unnecessary locks

## v1.14.1 (2026-07-10)

### Fix

- **registration**: improve searching by name

## v1.14.0 (2026-07-09)

### Feat

- **registration**: show event context on name-search matches
- **registration**: autosuggest recognition, registered-state fix, identity strip, animated feedback

### Fix

- **past-participations**: improve the search for past participations during new registratinos

## v1.13.4 (2026-07-04)

## v1.13.3 (2026-07-04)

### Fix

- **frontend**: improve page loading; refactor

## v1.13.2 (2026-07-04)

### Fix

- **email**: create an email notification even if the email was not verified but is present in the system; add auto-verification

## v1.13.1 (2026-06-09)

### Fix

- **frontend**: fix group stage frontend; add number of matches approximation

## v1.13.0 (2026-06-06)

### Feat

- **playoffs**: implement espejo logic; improve admin frontend for play offs

## v1.12.2 (2026-06-05)

### Fix

- **playoff**: fix po previes for 7/14 teams

## v1.12.1 (2026-06-05)

### Fix

- **playoffs**: court addition/removal

## v1.12.0 (2026-06-05)

### Feat

- **frontend-/-styling**: heavily refactor and refine the project styling

## v1.11.5 (2026-05-25)

### Fix

- **club**: performance and frontend fixes

## v1.11.4 (2026-05-25)

### Fix

- **public-view**: fix public club view; fix tennis format in mini cards

## v1.11.3 (2026-05-10)

### Fix

- **admin-frontend**: fix add/remove player in a tournament;improve filters in a tournament list

## v1.11.2 (2026-05-02)

### Fix

- **clubs**: fix domain resolution; fix player hub slug search

## v1.11.1 (2026-05-02)

### Fix

- **tests**: update tests

## v1.11.0 (2026-05-02)

### Feat

- **clubs**: add clubs home page; add tournamnets players mini cards; bug fixes

## v1.10.3 (2026-04-30)

### Fix

- **admin**: group stage sticky bar

## v1.10.2 (2026-04-30)

### Fix

- **frontend**: improve players and admins tournament ux

## v1.10.1 (2026-04-29)

### Fix

- **admin-clubs**: improve ux

## v1.10.0 (2026-04-28)

### Feat

- **admin**: re-organize admin panel in tournaments and lobby

## v1.9.8 (2026-04-23)

### Fix

- **admin**: hotfix admin interface

## v1.9.7 (2026-04-23)

### Fix

- admin

## v1.9.6 (2026-04-23)

### Fix

- **players**: allow deleting ghost profiles; scope club players to past participants

## v1.9.5 (2026-04-22)

### Fix

- **group-stage**: return sticky admin management bar

## v1.9.4 (2026-04-22)

### Fix

- **player-hub**: fix number of matches when recalculating elo

## v1.9.3 (2026-04-22)

### Fix

- **player-hub**: fix player hub view profile

## v1.9.2 (2026-04-22)

### Fix

- **clubs**: fix communities/clubs distinction; fix players management and conversion from ghost entities to permanent

## v1.9.1 (2026-04-22)

### Fix

- **profiles**: fixes for ghost profiles; frontend

## v1.9.0 (2026-04-21)

### Feat

- **community/clubs**: introduce communities functionality

## v1.8.5 (2026-04-20)

### Fix

- **admin**: creating new users from email; frontend improvement

## v1.8.4 (2026-04-17)

### Fix

- **elo;-frontend**: add scores confidence to elo; improve frontend for admin and player hub

## v1.8.3 (2026-04-17)

### Fix

- **frontend**: fix translations
- **admin-inteface**: improve group stage admin ux

## v1.8.1 (2026-04-16)

### Fix

- **player-hub**: sport selector behavior for elo when there are few matches

## v1.8.0 (2026-04-16)

### Feat

- **emails;-player-hub**: remember language preferences of users to send them emails in english or spanish; improve linking players to player hub, enhance frontend

## v1.7.10 (2026-04-16)

### Fix

- **player-hub**: show best results only for finished tournaments

## v1.7.9 (2026-04-16)

### Fix

- **player-hub**: improve frontend formatting

## v1.7.8 (2026-04-15)

### Fix

- **elo,-mexicano**: fix mexicano team mode; improve player hub elo ui; frontend fixes

## v1.7.7 (2026-04-15)

### Fix

- **elo**: fix elo history frontend

## v1.7.6 (2026-04-15)

### Fix

- **elo-history**: improve frontend

## v1.7.5 (2026-04-15)

### Fix

- **elo-history**: add sport selector

## v1.7.4 (2026-04-15)

### Fix

- **elo**: fix tests

## v1.7.3 (2026-04-15)

### Fix

- **readme**: add documentation on elo

## v1.7.2 (2026-04-15)

### Fix

- **elo**: fix recalculation from history for linked players

## v1.7.1 (2026-04-15)

### Fix

- **elo**: allow historical re-calculation

## v1.17.0 (2026-07-17)

### Feat

- **registration**: settings page, participant filter, and filtered messaging

### Refactor

- **registration**: status dots instead of tick/cross eligibility marks

## v1.14.11 (2026-07-13)

### Fix

- **performance**: optimize db connections

## v1.14.10 (2026-07-13)

### Fix

- **registration**: improve the wording for returning players

## v1.14.9 (2026-07-11)

### Fix

- **nginx**: fix nginx configuration

## v1.14.8 (2026-07-11)

### Fix

- **readability**: improve documentation

## v1.14.7 (2026-07-11)

### Fix

- **front**: improve caching

## v1.14.6 (2026-07-11)

### Fix

- **demo-mode**: add nginx file

## v1.14.5 (2026-07-11)

## v1.14.4 (2026-07-11)

### Fix

- **registration-claims**: fix admin view on claiming the account during the registration

## v1.14.3 (2026-07-11)

### Fix

- **frontend**: improve admin frontend, fix minor flaws (e.g. overflow on submit button during teams selection)

## v1.14.2 (2026-07-10)

### Fix

- **database**: optimize calls to a database; remove unnecessary locks

## v1.14.1 (2026-07-10)

### Fix

- **registration**: improve searching by name

## v1.14.0 (2026-07-09)

### Feat

- **registration**: show event context on name-search matches
- **registration**: autosuggest recognition, registered-state fix, identity strip, animated feedback

### Fix

- **past-participations**: improve the search for past participations during new registratinos

## v1.13.4 (2026-07-04)

## v1.13.3 (2026-07-04)

### Fix

- **frontend**: improve page loading; refactor

## v1.13.2 (2026-07-04)

### Fix

- **email**: create an email notification even if the email was not verified but is present in the system; add auto-verification

## v1.13.1 (2026-06-09)

### Fix

- **frontend**: fix group stage frontend; add number of matches approximation

## v1.13.0 (2026-06-06)

### Feat

- **playoffs**: implement espejo logic; improve admin frontend for play offs

## v1.12.2 (2026-06-05)

### Fix

- **playoff**: fix po previes for 7/14 teams

## v1.12.1 (2026-06-05)

### Fix

- **playoffs**: court addition/removal

## v1.12.0 (2026-06-05)

### Feat

- **frontend-/-styling**: heavily refactor and refine the project styling

## v1.11.5 (2026-05-25)

### Fix

- **club**: performance and frontend fixes

## v1.11.4 (2026-05-25)

### Fix

- **public-view**: fix public club view; fix tennis format in mini cards

## v1.11.3 (2026-05-10)

### Fix

- **admin-frontend**: fix add/remove player in a tournament;improve filters in a tournament list

## v1.11.2 (2026-05-02)

### Fix

- **clubs**: fix domain resolution; fix player hub slug search

## v1.11.1 (2026-05-02)

### Fix

- **tests**: update tests

## v1.11.0 (2026-05-02)

### Feat

- **clubs**: add clubs home page; add tournamnets players mini cards; bug fixes

## v1.10.3 (2026-04-30)

### Fix

- **admin**: group stage sticky bar

## v1.10.2 (2026-04-30)

### Fix

- **frontend**: improve players and admins tournament ux

## v1.10.1 (2026-04-29)

### Fix

- **admin-clubs**: improve ux

## v1.10.0 (2026-04-28)

### Feat

- **admin**: re-organize admin panel in tournaments and lobby

## v1.9.8 (2026-04-23)

### Fix

- **admin**: hotfix admin interface

## v1.9.7 (2026-04-23)

### Fix

- admin

## v1.9.6 (2026-04-23)

### Fix

- **players**: allow deleting ghost profiles; scope club players to past participants

## v1.9.5 (2026-04-22)

### Fix

- **group-stage**: return sticky admin management bar

## v1.9.4 (2026-04-22)

### Fix

- **player-hub**: fix number of matches when recalculating elo

## v1.9.3 (2026-04-22)

### Fix

- **player-hub**: fix player hub view profile

## v1.9.2 (2026-04-22)

### Fix

- **clubs**: fix communities/clubs distinction; fix players management and conversion from ghost entities to permanent

## v1.9.1 (2026-04-22)

### Fix

- **profiles**: fixes for ghost profiles; frontend

## v1.9.0 (2026-04-21)

### Feat

- **community/clubs**: introduce communities functionality

## v1.8.5 (2026-04-20)

### Fix

- **admin**: creating new users from email; frontend improvement

## v1.8.4 (2026-04-17)

### Fix

- **elo;-frontend**: add scores confidence to elo; improve frontend for admin and player hub

## v1.8.3 (2026-04-17)

### Fix

- **frontend**: fix translations
- **admin-inteface**: improve group stage admin ux

## v1.8.1 (2026-04-16)

### Fix

- **player-hub**: sport selector behavior for elo when there are few matches

## v1.8.0 (2026-04-16)

### Feat

- **emails;-player-hub**: remember language preferences of users to send them emails in english or spanish; improve linking players to player hub, enhance frontend

## v1.7.10 (2026-04-16)

### Fix

- **player-hub**: show best results only for finished tournaments

## v1.7.9 (2026-04-16)

### Fix

- **player-hub**: improve frontend formatting

## v1.7.8 (2026-04-15)

### Fix

- **elo,-mexicano**: fix mexicano team mode; improve player hub elo ui; frontend fixes

## v1.7.7 (2026-04-15)

### Fix

- **elo**: fix elo history frontend

## v1.7.6 (2026-04-15)

### Fix

- **elo-history**: improve frontend

## v1.7.5 (2026-04-15)

### Fix

- **elo-history**: add sport selector

## v1.7.4 (2026-04-15)

### Fix

- **elo**: fix tests

## v1.7.3 (2026-04-15)

### Fix

- **readme**: add documentation on elo

## v1.7.2 (2026-04-15)

### Fix

- **elo**: fix recalculation from history for linked players

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

## v1.16.0 (2026-07-17)

### Feat

- **registration**: settings page, participant filter, and filtered messaging

### Refactor

- **registration**: status dots instead of tick/cross eligibility marks

## v1.14.11 (2026-07-13)

### Fix

- **performance**: optimize db connections

## v1.14.10 (2026-07-13)

### Fix

- **registration**: improve the wording for returning players

## v1.14.9 (2026-07-11)

### Fix

- **nginx**: fix nginx configuration

## v1.14.8 (2026-07-11)

### Fix

- **readability**: improve documentation

## v1.14.7 (2026-07-11)

### Fix

- **front**: improve caching

## v1.14.6 (2026-07-11)

### Fix

- **demo-mode**: add nginx file

## v1.14.5 (2026-07-11)

## v1.14.4 (2026-07-11)

### Fix

- **registration-claims**: fix admin view on claiming the account during the registration

## v1.14.3 (2026-07-11)

### Fix

- **frontend**: improve admin frontend, fix minor flaws (e.g. overflow on submit button during teams selection)

## v1.14.2 (2026-07-10)

### Fix

- **database**: optimize calls to a database; remove unnecessary locks

## v1.14.1 (2026-07-10)

### Fix

- **registration**: improve searching by name

## v1.14.0 (2026-07-09)

### Fix

- **past-participations**: improve the search for past participations during new registratinos

## v1.15.0 (2026-07-17)

### Feat

- **registration**: settings page, participant filter, and filtered messaging

### Refactor

- **registration**: status dots instead of tick/cross eligibility marks

## v1.14.11 (2026-07-13)

### Fix

- **performance**: optimize db connections

## v1.14.10 (2026-07-13)

### Fix

- **registration**: improve the wording for returning players

## v1.14.9 (2026-07-11)

### Fix

- **nginx**: fix nginx configuration

## v1.14.8 (2026-07-11)

### Fix

- **readability**: improve documentation

## v1.14.7 (2026-07-11)

### Fix

- **front**: improve caching

## v1.14.6 (2026-07-11)

### Fix

- **demo-mode**: add nginx file

## v1.14.5 (2026-07-11)

### Fix

- **demo-mode**: add nginx file

## v1.14.5 (2026-07-11)

## v1.14.4 (2026-07-11)

### Fix

- **registration-claims**: fix admin view on claiming the account during the registration

## v1.14.3 (2026-07-11)

### Fix

- **frontend**: improve admin frontend, fix minor flaws (e.g. overflow on submit button during teams selection)

## v1.14.2 (2026-07-10)

### Fix

- **database**: optimize calls to a database; remove unnecessary locks

## v1.14.1 (2026-07-10)

### Fix

- **registration**: improve searching by name

## v1.14.0 (2026-07-09)

### Feat

- **registration**: show event context on name-search matches
- **registration**: autosuggest recognition, registered-state fix, identity strip, animated feedback

### Fix

- **past-participations**: improve the search for past participations during new registratinos

## v1.13.4 (2026-07-04)

## v1.13.3 (2026-07-04)

### Fix

- **frontend**: improve page loading; refactor

## v1.13.2 (2026-07-04)

### Fix

- **email**: create an email notification even if the email was not verified but is present in the system; add auto-verification

## v1.13.1 (2026-06-09)

### Fix

- **frontend**: fix group stage frontend; add number of matches approximation

## v1.13.0 (2026-06-06)

### Feat

- **playoffs**: implement espejo logic; improve admin frontend for play offs

## v1.12.2 (2026-06-05)

### Fix

- **playoff**: fix po previes for 7/14 teams

## v1.12.1 (2026-06-05)

### Fix

- **playoffs**: court addition/removal

## v1.12.0 (2026-06-05)

### Feat

- **frontend-/-styling**: heavily refactor and refine the project styling

## v1.11.5 (2026-05-25)

### Fix

- **club**: performance and frontend fixes

## v1.11.4 (2026-05-25)

### Fix

- **public-view**: fix public club view; fix tennis format in mini cards

## v1.11.3 (2026-05-10)

### Fix

- **admin-frontend**: fix add/remove player in a tournament;improve filters in a tournament list

## v1.11.2 (2026-05-02)

### Fix

- **clubs**: fix domain resolution; fix player hub slug search

## v1.11.1 (2026-05-02)

### Fix

- **tests**: update tests

## v1.11.0 (2026-05-02)

### Feat

- **clubs**: add clubs home page; add tournamnets players mini cards; bug fixes

## v1.10.3 (2026-04-30)

### Fix

- **admin**: group stage sticky bar

## v1.10.2 (2026-04-30)

### Fix

- **frontend**: improve players and admins tournament ux

## v1.10.1 (2026-04-29)

### Fix

- **admin-clubs**: improve ux

## v1.10.0 (2026-04-28)

### Feat

- **admin**: re-organize admin panel in tournaments and lobby

## v1.9.8 (2026-04-23)

### Fix

- **admin**: hotfix admin interface

## v1.9.7 (2026-04-23)

### Fix

- admin

## v1.9.6 (2026-04-23)

### Fix

- **players**: allow deleting ghost profiles; scope club players to past participants

## v1.9.5 (2026-04-22)

### Fix

- **group-stage**: return sticky admin management bar

## v1.9.4 (2026-04-22)

### Fix

- **player-hub**: fix number of matches when recalculating elo

## v1.9.3 (2026-04-22)

### Fix

- **player-hub**: fix player hub view profile

## v1.9.2 (2026-04-22)

### Fix

- **clubs**: fix communities/clubs distinction; fix players management and conversion from ghost entities to permanent

## v1.9.1 (2026-04-22)

### Fix

- **profiles**: fixes for ghost profiles; frontend

## v1.9.0 (2026-04-21)

### Feat

- **community/clubs**: introduce communities functionality

## v1.8.5 (2026-04-20)

### Fix

- **admin**: creating new users from email; frontend improvement

## v1.8.4 (2026-04-17)

### Fix

- **elo;-frontend**: add scores confidence to elo; improve frontend for admin and player hub

## v1.8.3 (2026-04-17)

### Fix

- **frontend**: fix translations
- **admin-inteface**: improve group stage admin ux

## v1.8.1 (2026-04-16)

### Fix

- **player-hub**: sport selector behavior for elo when there are few matches

## v1.8.0 (2026-04-16)

### Feat

- **emails;-player-hub**: remember language preferences of users to send them emails in english or spanish; improve linking players to player hub, enhance frontend

## v1.7.10 (2026-04-16)

### Fix

- **player-hub**: show best results only for finished tournaments

## v1.7.9 (2026-04-16)

### Fix

- **player-hub**: improve frontend formatting

## v1.7.8 (2026-04-15)

### Fix

- **elo,-mexicano**: fix mexicano team mode; improve player hub elo ui; frontend fixes

## v1.7.7 (2026-04-15)

### Fix

- **elo**: fix elo history frontend

## v1.7.6 (2026-04-15)

### Fix

- **elo-history**: improve frontend

## v1.7.5 (2026-04-15)

### Fix

- **elo-history**: add sport selector

## v1.7.4 (2026-04-15)

### Fix

- **elo**: fix tests

## v1.7.3 (2026-04-15)

### Fix

- **readme**: add documentation on elo

## v1.7.2 (2026-04-15)

### Fix

- **elo**: fix recalculation from history for linked players

## v1.7.1 (2026-04-15)

### Fix

- **elo**: allow historical re-calculation

## v1.17.0 (2026-07-09)

### Feat

- **registration**: show event context on name-search matches
- **registration**: autosuggest recognition, registered-state fix, identity strip, animated feedback

### Fix

- **past-participations**: improve the search for past participations during new registratinos

## v1.13.4 (2026-07-04)

## v1.13.3 (2026-07-04)

### Fix

- **frontend**: improve page loading; refactor

## v1.13.2 (2026-07-04)

### Fix

- **email**: create an email notification even if the email was not verified but is present in the system; add auto-verification

## v1.13.1 (2026-06-09)

### Fix

- **frontend**: fix group stage frontend; add number of matches approximation

## v1.13.0 (2026-06-06)

### Feat

- **playoffs**: implement espejo logic; improve admin frontend for play offs

## v1.12.2 (2026-06-05)

### Fix

- **playoff**: fix po previes for 7/14 teams

## v1.12.1 (2026-06-05)

### Fix

- **playoffs**: court addition/removal

## v1.12.0 (2026-06-05)

### Feat

- **frontend-/-styling**: heavily refactor and refine the project styling

## v1.11.5 (2026-05-25)

### Fix

- **club**: performance and frontend fixes

## v1.11.4 (2026-05-25)

### Fix

- **public-view**: fix public club view; fix tennis format in mini cards

## v1.11.3 (2026-05-10)

### Fix

- **admin-frontend**: fix add/remove player in a tournament;improve filters in a tournament list

## v1.11.2 (2026-05-02)

### Fix

- **clubs**: fix domain resolution; fix player hub slug search

## v1.11.1 (2026-05-02)

### Fix

- **tests**: update tests

## v1.11.0 (2026-05-02)

### Feat

- **clubs**: add clubs home page; add tournamnets players mini cards; bug fixes

## v1.10.3 (2026-04-30)

### Fix

- **admin**: group stage sticky bar

## v1.10.2 (2026-04-30)

### Fix

- **frontend**: improve players and admins tournament ux

## v1.10.1 (2026-04-29)

### Fix

- **admin-clubs**: improve ux

## v1.10.0 (2026-04-28)

### Feat

- **admin**: re-organize admin panel in tournaments and lobby

## v1.9.8 (2026-04-23)

### Fix

- **admin**: hotfix admin interface

## v1.9.7 (2026-04-23)

### Fix

- admin

## v1.9.6 (2026-04-23)

### Fix

- **players**: allow deleting ghost profiles; scope club players to past participants

## v1.9.5 (2026-04-22)

### Fix

- **group-stage**: return sticky admin management bar

## v1.9.4 (2026-04-22)

### Fix

- **player-hub**: fix number of matches when recalculating elo

## v1.9.3 (2026-04-22)

### Fix

- **player-hub**: fix player hub view profile

## v1.9.2 (2026-04-22)

### Fix

- **clubs**: fix communities/clubs distinction; fix players management and conversion from ghost entities to permanent

## v1.9.1 (2026-04-22)

### Fix

- **profiles**: fixes for ghost profiles; frontend

## v1.9.0 (2026-04-21)

### Feat

- **community/clubs**: introduce communities functionality

## v1.8.5 (2026-04-20)

### Fix

- **admin**: creating new users from email; frontend improvement

## v1.8.4 (2026-04-17)

### Fix

- **elo;-frontend**: add scores confidence to elo; improve frontend for admin and player hub

## v1.8.3 (2026-04-17)

### Fix

- **frontend**: fix translations
- **admin-inteface**: improve group stage admin ux

## v1.8.1 (2026-04-16)

### Fix

- **player-hub**: sport selector behavior for elo when there are few matches

## v1.8.0 (2026-04-16)

### Feat

- **emails;-player-hub**: remember language preferences of users to send them emails in english or spanish; improve linking players to player hub, enhance frontend

## v1.7.10 (2026-04-16)

### Fix

- **player-hub**: show best results only for finished tournaments

## v1.7.9 (2026-04-16)

### Fix

- **player-hub**: improve frontend formatting

## v1.7.8 (2026-04-15)

### Fix

- **elo,-mexicano**: fix mexicano team mode; improve player hub elo ui; frontend fixes

## v1.7.7 (2026-04-15)

### Fix

- **elo**: fix elo history frontend

## v1.7.6 (2026-04-15)

### Fix

- **elo-history**: improve frontend

## v1.7.5 (2026-04-15)

### Fix

- **elo-history**: add sport selector

## v1.7.4 (2026-04-15)

### Fix

- **elo**: fix tests

## v1.7.3 (2026-04-15)

### Fix

- **readme**: add documentation on elo

## v1.7.2 (2026-04-15)

### Fix

- **elo**: fix recalculation from history for linked players

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

## v1.16.0 (2026-07-09)

### Fix

- **past-participations**: improve the search for past participations during new registratinos

## v1.15.0 (2026-07-09)

### Feat

- **registration**: show event context on name-search matches
- **registration**: autosuggest recognition, registered-state fix, identity strip, animated feedback

### Fix

- **past-participations**: improve the search for past participations during new registratinos

## v1.13.4 (2026-07-04)

## v1.13.3 (2026-07-04)

### Fix

- **frontend**: improve page loading; refactor

## v1.13.2 (2026-07-04)

### Fix

- **email**: create an email notification even if the email was not verified but is present in the system; add auto-verification

## v1.13.1 (2026-06-09)

### Fix

- **frontend**: fix group stage frontend; add number of matches approximation

## v1.13.0 (2026-06-06)

### Feat

- **playoffs**: implement espejo logic; improve admin frontend for play offs

## v1.12.2 (2026-06-05)

### Fix

- **playoff**: fix po previes for 7/14 teams

## v1.12.1 (2026-06-05)

### Fix

- **playoffs**: court addition/removal

## v1.12.0 (2026-06-05)

### Feat

- **frontend-/-styling**: heavily refactor and refine the project styling

## v1.11.5 (2026-05-25)

### Fix

- **club**: performance and frontend fixes

## v1.11.4 (2026-05-25)

### Fix

- **public-view**: fix public club view; fix tennis format in mini cards

## v1.11.3 (2026-05-10)

### Fix

- **admin-frontend**: fix add/remove player in a tournament;improve filters in a tournament list

## v1.11.2 (2026-05-02)

### Fix

- **clubs**: fix domain resolution; fix player hub slug search

## v1.11.1 (2026-05-02)

### Fix

- **tests**: update tests

## v1.11.0 (2026-05-02)

### Feat

- **clubs**: add clubs home page; add tournamnets players mini cards; bug fixes

## v1.10.3 (2026-04-30)

### Fix

- **admin**: group stage sticky bar

## v1.10.2 (2026-04-30)

### Fix

- **frontend**: improve players and admins tournament ux

## v1.10.1 (2026-04-29)

### Fix

- **admin-clubs**: improve ux

## v1.10.0 (2026-04-28)

### Feat

- **admin**: re-organize admin panel in tournaments and lobby

## v1.9.8 (2026-04-23)

### Fix

- **admin**: hotfix admin interface

## v1.9.7 (2026-04-23)

### Fix

- admin

## v1.9.6 (2026-04-23)

### Fix

- **players**: allow deleting ghost profiles; scope club players to past participants

## v1.9.5 (2026-04-22)

### Fix

- **group-stage**: return sticky admin management bar

## v1.9.4 (2026-04-22)

### Fix

- **player-hub**: fix number of matches when recalculating elo

## v1.9.3 (2026-04-22)

### Fix

- **player-hub**: fix player hub view profile

## v1.9.2 (2026-04-22)

### Fix

- **clubs**: fix communities/clubs distinction; fix players management and conversion from ghost entities to permanent

## v1.9.1 (2026-04-22)

### Fix

- **profiles**: fixes for ghost profiles; frontend

## v1.9.0 (2026-04-21)

### Feat

- **community/clubs**: introduce communities functionality

## v1.8.5 (2026-04-20)

### Fix

- **admin**: creating new users from email; frontend improvement

## v1.8.4 (2026-04-17)

### Fix

- **elo;-frontend**: add scores confidence to elo; improve frontend for admin and player hub

## v1.8.3 (2026-04-17)

### Fix

- **frontend**: fix translations
- **admin-inteface**: improve group stage admin ux

## v1.8.1 (2026-04-16)

### Fix

- **player-hub**: sport selector behavior for elo when there are few matches

## v1.8.0 (2026-04-16)

### Feat

- **emails;-player-hub**: remember language preferences of users to send them emails in english or spanish; improve linking players to player hub, enhance frontend

## v1.7.10 (2026-04-16)

### Fix

- **player-hub**: show best results only for finished tournaments

## v1.7.9 (2026-04-16)

### Fix

- **player-hub**: improve frontend formatting

## v1.7.8 (2026-04-15)

### Fix

- **elo,-mexicano**: fix mexicano team mode; improve player hub elo ui; frontend fixes

## v1.7.7 (2026-04-15)

### Fix

- **elo**: fix elo history frontend

## v1.7.6 (2026-04-15)

### Fix

- **elo-history**: improve frontend

## v1.7.5 (2026-04-15)

### Fix

- **elo-history**: add sport selector

## v1.7.4 (2026-04-15)

### Fix

- **elo**: fix tests

## v1.7.3 (2026-04-15)

### Fix

- **readme**: add documentation on elo

## v1.7.2 (2026-04-15)

### Fix

- **elo**: fix recalculation from history for linked players

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

## v1.14.0 (2026-07-09)

### Feat

- **registration**: show event context on name-search matches
- **registration**: autosuggest recognition, registered-state fix, identity strip, animated feedback

## v1.13.4 (2026-07-04)

## v1.13.3 (2026-07-04)

### Fix

- **frontend**: improve page loading; refactor

## v1.13.2 (2026-07-04)

### Fix

- **email**: create an email notification even if the email was not verified but is present in the system; add auto-verification

## v1.13.1 (2026-06-09)

### Fix

- **frontend**: fix group stage frontend; add number of matches approximation

## v1.13.0 (2026-06-06)

### Feat

- **playoffs**: implement espejo logic; improve admin frontend for play offs

## v1.12.2 (2026-06-05)

### Fix

- **playoff**: fix po previes for 7/14 teams

## v1.12.1 (2026-06-05)

### Fix

- **playoffs**: court addition/removal

## v1.12.0 (2026-06-05)

### Feat

- **frontend-/-styling**: heavily refactor and refine the project styling

## v1.11.5 (2026-05-25)

### Fix

- **club**: performance and frontend fixes

## v1.11.4 (2026-05-25)

### Fix

- **public-view**: fix public club view; fix tennis format in mini cards

## v1.11.3 (2026-05-10)

### Fix

- **admin-frontend**: fix add/remove player in a tournament;improve filters in a tournament list

## v1.11.2 (2026-05-02)

### Fix

- **clubs**: fix domain resolution; fix player hub slug search

## v1.11.1 (2026-05-02)

### Fix

- **tests**: update tests

## v1.11.0 (2026-05-02)

### Feat

- **clubs**: add clubs home page; add tournamnets players mini cards; bug fixes

## v1.10.3 (2026-04-30)

### Fix

- **admin**: group stage sticky bar

## v1.10.2 (2026-04-30)

### Fix

- **frontend**: improve players and admins tournament ux

## v1.10.1 (2026-04-29)

### Fix

- **admin-clubs**: improve ux

## v1.10.0 (2026-04-28)

### Feat

- **admin**: re-organize admin panel in tournaments and lobby

## v1.9.8 (2026-04-23)

### Fix

- **admin**: hotfix admin interface

## v1.9.7 (2026-04-23)

### Fix

- admin

## v1.9.6 (2026-04-23)

### Fix

- **players**: allow deleting ghost profiles; scope club players to past participants

## v1.9.5 (2026-04-22)

### Fix

- **group-stage**: return sticky admin management bar

## v1.9.4 (2026-04-22)

### Fix

- **player-hub**: fix number of matches when recalculating elo

## v1.9.3 (2026-04-22)

### Fix

- **player-hub**: fix player hub view profile

## v1.9.2 (2026-04-22)

### Fix

- **clubs**: fix communities/clubs distinction; fix players management and conversion from ghost entities to permanent

## v1.9.1 (2026-04-22)

### Fix

- **profiles**: fixes for ghost profiles; frontend

## v1.9.0 (2026-04-21)

### Feat

- **community/clubs**: introduce communities functionality

## v1.8.5 (2026-04-20)

### Fix

- **admin**: creating new users from email; frontend improvement

## v1.8.4 (2026-04-17)

### Fix

- **elo;-frontend**: add scores confidence to elo; improve frontend for admin and player hub

## v1.8.3 (2026-04-17)

### Fix

- **frontend**: fix translations

## v1.8.2 (2026-04-17)

### Fix

- **admin-inteface**: improve group stage admin ux

## v1.8.1 (2026-04-16)

### Fix

- **player-hub**: sport selector behavior for elo when there are few matches

## v1.8.0 (2026-04-16)

### Feat

- **emails;-player-hub**: remember language preferences of users to send them emails in english or spanish; improve linking players to player hub, enhance frontend

## v1.7.10 (2026-04-16)

### Fix

- **player-hub**: show best results only for finished tournaments

## v1.7.9 (2026-04-16)

### Fix

- **player-hub**: improve frontend formatting

## v1.7.8 (2026-04-15)

### Fix

- **elo,-mexicano**: fix mexicano team mode; improve player hub elo ui; frontend fixes

## v1.7.7 (2026-04-15)

### Fix

- **elo**: fix elo history frontend

## v1.7.6 (2026-04-15)

### Fix

- **elo-history**: improve frontend

## v1.7.5 (2026-04-15)

### Fix

- **elo-history**: add sport selector

## v1.7.4 (2026-04-15)

### Fix

- **elo**: fix tests

## v1.7.3 (2026-04-15)

### Fix

- **readme**: add documentation on elo

## v1.7.2 (2026-04-15)

### Fix

- **elo**: fix recalculation from history for linked players

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
