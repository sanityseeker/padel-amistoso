---
name: ux-review
description: Review and critique a UI or interface, suggest improvements to UX, usability, user flow, layouts, interactions, and evaluate screens/components from a user perspective.
---
# UX Review

## When to activate this skill
Activate when the user asks to:
- review, critique, or audit a UI or interface
- improve UX, usability, or user flow
- suggest better layouts or interactions
- evaluate a screen or component from a user perspective
- propose design alternatives

## Review Framework
When reviewing any UI, evaluate across these dimensions:

### 0. Ask for a service / app context or get it from the user input / conversation. The context will guide your review and suggestions.

### 1. Clarity — Can the user tell what to do in 1 second?
- Is there ONE clear primary action per screen?
- Are labels descriptive (not "Submit" but "Register for tournament")?
- Is the current state always visible (active round, score, player status)?
- Are errors specific ("Court 3 is full" not "Error")?

### 2. Flow — Does the sequence make sense?
- Does the order of steps match the user's mental model?
- Are irreversible actions (delete, confirm result) protected with confirmation?
- Can the user always get back to where they were?
- Are multi-step processes (registration, match creation) broken into clear stages?

### 3. Hierarchy — Is the most important information most visible?
- Does visual weight match information priority?
- Are scores/results the dominant element in player/TV views?
- Is admin-only information visually separated from player-facing content?
- Are secondary actions (edit, delete) less prominent than primary ones?

### 4. Consistency — Do similar things look and behave the same?
- Do all forms follow the same pattern?
- Do all destructive actions share the same visual treatment?
- Are status indicators (active, pending, complete) consistent across views?

### 5. Feedback — Does the UI respond to user actions?
- Do form submissions show loading states?
- Are success/error states visible and specific?
- Do score updates animate or just snap?
- Are empty states informative (not just blank)?

### 6. Mobile/Context fit
- Admin view: is it usable on a tablet at courtside?
- Player view: readable in sunlight, one-handed use?
- TV view: legible at 3+ meters?
- Register view: completable on mobile without frustration?

## Output format
When reviewing, always return:

### Critical issues (fix before anything else)
Issues that block task completion or cause confusion.

### UX improvements (high impact)
Changes that significantly improve usability with moderate effort.

### Design proposals (optional enhancements)
Specific alternative layouts or interaction patterns with rationale.
Include a brief ASCII sketch or description of the proposed layout when relevant.

## Padel tournament context
Key user types and their goals:
- **Admin/organizer**: create tournaments, manage rounds, input scores quickly
- **Player**: check their schedule, see scores, know which court to go to
- **Spectator (TV)**: read scores from distance, follow live rounds
- **New registrant**: sign up without confusion, know what info is needed

Always evaluate UI against the specific user type it serves.