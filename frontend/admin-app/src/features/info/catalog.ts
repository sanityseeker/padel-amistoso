// Generated once from the legacy admin's Info tab (index.html + i18n.js): the structure of the page and
// its English and Spanish text. The strings are first-party HTML fragments (<strong>, <code>, <em>, <li>),
// rendered inside Mantine's Typography, never user input.
export interface InfoPara {
  key: string;
  html: boolean;
  list: boolean;
}
export interface InfoItem {
  title: string;
  paras: InfoPara[];
}
export interface InfoSection {
  id: string;
  title: string | null;
  intro: InfoPara[];
  items: InfoItem[];
}
export const SECTIONS: InfoSection[] = [
  {
    id: 'info-intro',
    title: 'txt_txt_info',
    intro: [
      {
        key: 'txt_txt_info_tab_desc',
        html: false,
        list: false,
      },
    ],
    items: [],
  },
  {
    id: 'info-at-a-glance',
    title: 'txt_txt_info_glance_title',
    intro: [],
    items: [
      {
        title: 'txt_txt_info_glance_pages_title',
        paras: [
          {
            key: 'txt_txt_info_glance_pages_desc',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_glance_no_accounts_title',
        paras: [
          {
            key: 'txt_txt_info_glance_no_accounts_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_glance_designed_title',
        paras: [
          {
            key: 'txt_txt_info_glance_designed_desc',
            html: false,
            list: false,
          },
        ],
      },
    ],
  },
  {
    id: 'info-quickstart',
    title: 'txt_txt_info_qs_title',
    intro: [],
    items: [
      {
        title: 'txt_txt_info_qs_step1_title',
        paras: [
          {
            key: 'txt_txt_info_qs_step1_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_qs_step2_title',
        paras: [
          {
            key: 'txt_txt_info_qs_step2_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_qs_step3_title',
        paras: [
          {
            key: 'txt_txt_info_qs_step3_desc',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_qs_step4_title',
        paras: [
          {
            key: 'txt_txt_info_qs_step4_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_qs_step5_title',
        paras: [
          {
            key: 'txt_txt_info_qs_step5_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_qs_where_title',
        paras: [
          {
            key: 'txt_txt_info_qs_where_list',
            html: true,
            list: true,
          },
        ],
      },
    ],
  },
  {
    id: 'info-demo',
    title: 'txt_txt_info_demo_title',
    intro: [],
    items: [
      {
        title: 'txt_txt_info_demo_full_title',
        paras: [
          {
            key: 'txt_txt_info_demo_full_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_demo_sandbox_title',
        paras: [
          {
            key: 'txt_txt_info_demo_sandbox_desc',
            html: true,
            list: false,
          },
          {
            key: 'txt_txt_info_demo_sandbox_desc_instance',
            html: true,
            list: false,
          },
        ],
      },
    ],
  },
  {
    id: 'info-player-flow',
    title: 'txt_txt_info_player_flow_title',
    intro: [],
    items: [
      {
        title: 'txt_txt_info_player_flow_join_title',
        paras: [
          {
            key: 'txt_txt_info_player_flow_join_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_player_flow_access_title',
        paras: [
          {
            key: 'txt_txt_info_player_flow_access_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_player_flow_participate_title',
        paras: [
          {
            key: 'txt_txt_info_player_flow_participate_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_player_flow_informed_title',
        paras: [
          {
            key: 'txt_txt_info_player_flow_informed_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_player_flow_hub_title',
        paras: [
          {
            key: 'txt_txt_info_player_flow_hub_desc1',
            html: true,
            list: false,
          },
          {
            key: 'txt_txt_info_player_flow_hub_desc2',
            html: false,
            list: false,
          },
          {
            key: 'txt_txt_info_player_flow_hub_desc3',
            html: false,
            list: false,
          },
        ],
      },
    ],
  },
  {
    id: 'info-admin-flow',
    title: 'txt_txt_info_admin_flow_title',
    intro: [],
    items: [
      {
        title: 'txt_txt_info_admin_flow_prepare_title',
        paras: [
          {
            key: 'txt_txt_info_admin_flow_prepare_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_admin_flow_launch_title',
        paras: [
          {
            key: 'txt_txt_info_admin_flow_launch_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_admin_flow_creds_title',
        paras: [
          {
            key: 'txt_txt_info_admin_flow_creds_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_admin_flow_rounds_title',
        paras: [
          {
            key: 'txt_txt_info_admin_flow_rounds_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_admin_flow_team_title',
        paras: [
          {
            key: 'txt_txt_info_admin_flow_team_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_admin_flow_comm_title',
        paras: [
          {
            key: 'txt_txt_info_admin_flow_comm_desc',
            html: false,
            list: false,
          },
        ],
      },
    ],
  },
  {
    id: 'info-main-features',
    title: 'txt_txt_info_main_features_title',
    intro: [],
    items: [
      {
        title: 'txt_txt_info_main_features_reg_title',
        paras: [
          {
            key: 'txt_txt_info_main_features_reg_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_main_features_live_title',
        paras: [
          {
            key: 'txt_txt_info_main_features_live_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_main_features_access_title',
        paras: [
          {
            key: 'txt_txt_info_main_features_access_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_main_features_tv_title',
        paras: [
          {
            key: 'txt_txt_info_main_features_tv_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_main_features_pay_title',
        paras: [{ key: 'txt_txt_info_main_features_pay_desc', html: true, list: false }],
      },
      {
        title: 'txt_txt_info_main_features_withdraw_title',
        paras: [{ key: 'txt_txt_info_main_features_withdraw_desc', html: true, list: false }],
      },
    ],
  },
  {
    id: 'info-communities-clubs',
    title: 'txt_txt_info_comm_clubs_title',
    intro: [
      {
        key: 'txt_txt_info_comm_clubs_subtitle',
        html: false,
        list: false,
      },
    ],
    items: [
      {
        title: 'txt_txt_info_comm_clubs_scope_title',
        paras: [
          {
            key: 'txt_txt_info_comm_clubs_scope_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_comm_clubs_club_title',
        paras: [
          {
            key: 'txt_txt_info_comm_clubs_club_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_comm_clubs_when_title',
        paras: [
          {
            key: 'txt_txt_info_comm_clubs_when_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_comm_clubs_upgrade_title',
        paras: [
          {
            key: 'txt_txt_info_comm_clubs_upgrade_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_comm_clubs_scope_change_title',
        paras: [
          {
            key: 'txt_txt_info_comm_clubs_scope_change_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_comm_clubs_practice_title',
        paras: [
          {
            key: 'txt_txt_info_comm_clubs_practice_desc',
            html: false,
            list: false,
          },
        ],
      },
    ],
  },
  {
    id: 'info-formats',
    title: 'txt_txt_info_formats_title',
    intro: [],
    items: [
      {
        title: 'txt_txt_info_formats_gp_title',
        paras: [
          {
            key: 'txt_txt_info_formats_gp_desc1',
            html: false,
            list: false,
          },
          {
            key: 'txt_txt_info_formats_gp_desc2',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_formats_mex_title',
        paras: [
          {
            key: 'txt_txt_info_formats_mex_desc1',
            html: false,
            list: false,
          },
          {
            key: 'txt_txt_info_formats_mex_desc2',
            html: true,
            list: false,
          },
          {
            key: 'txt_txt_info_formats_mex_list',
            html: true,
            list: true,
          },
        ],
      },
      {
        title: 'txt_txt_info_formats_po_title',
        paras: [
          {
            key: 'txt_txt_info_formats_po_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_formats_elim_title',
        paras: [
          {
            key: 'txt_txt_info_formats_elim_desc',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_formats_schema_title',
        paras: [
          {
            key: 'txt_txt_info_formats_schema_desc',
            html: false,
            list: false,
          },
        ],
      },
    ],
  },
  {
    id: 'info-elo',
    title: 'txt_txt_info_elo_title',
    intro: [
      {
        key: 'txt_txt_info_elo_subtitle',
        html: false,
        list: false,
      },
    ],
    items: [
      {
        title: 'txt_txt_info_elo_formula_title',
        paras: [
          {
            key: 'txt_txt_info_elo_formula_desc',
            html: true,
            list: false,
          },
          {
            key: 'txt_txt_info_elo_formula_legend',
            html: true,
            list: false,
          },
          {
            key: 'txt_txt_info_elo_formula_s_note',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_elo_update_title',
        paras: [
          {
            key: 'txt_txt_info_elo_update_desc',
            html: true,
            list: false,
          },
          {
            key: 'txt_txt_info_elo_update_legend',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_elo_kfactor_title',
        paras: [
          {
            key: 'txt_txt_info_elo_kfactor_desc',
            html: false,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_elo_reliability_title',
        paras: [
          {
            key: 'txt_txt_info_elo_reliability_desc',
            html: true,
            list: false,
          },
          {
            key: 'txt_txt_info_elo_reliability_legend',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_elo_doubles_title',
        paras: [
          {
            key: 'txt_txt_info_elo_doubles_desc',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_elo_clamp_title',
        paras: [
          {
            key: 'txt_txt_info_elo_clamp_desc',
            html: false,
            list: false,
          },
        ],
      },
    ],
  },
  {
    id: 'info-po-transition',
    title: 'txt_txt_info_po_trans_title',
    intro: [],
    items: [
      {
        title: 'txt_txt_info_po_trans_gp_title',
        paras: [
          {
            key: 'txt_txt_info_po_trans_gp_desc',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_po_trans_mex_title',
        paras: [
          {
            key: 'txt_txt_info_po_trans_mex_desc',
            html: true,
            list: false,
          },
        ],
      },
      {
        title: 'txt_txt_info_po_trans_ext_title',
        paras: [
          {
            key: 'txt_txt_info_po_trans_ext_desc',
            html: false,
            list: false,
          },
        ],
      },
    ],
  },
  {
    id: 'info-intro',
    title: null,
    intro: [],
    items: [],
  },
];
export const CATALOG: Record<'en' | 'es' | 'ru', Record<string, string>> = {
  en: {
    txt_txt_info: 'Info',
    txt_txt_info_admin_flow_comm_desc:
      'Post announcements. They show on the view of each player and on the TV display. Send email notifications to all players or to selected players. When the event is complete, export a self-contained HTML or PDF summary with the full bracket and all match results. Then archive the tournament to keep your list short.',
    txt_txt_info_admin_flow_comm_title: '6) Communicate and finish',
    txt_txt_info_admin_flow_creds_desc:
      'On the tournament page, open the Players tab. There you can see, copy, download, or print all passphrases as QR-code cards. You can also send the passphrases by email, to one player or to all players. Players can link their passphrase to their Player Hub profile. Then they see all their events in one place.',
    txt_txt_info_admin_flow_creds_title: '3) Send the player passphrases',
    txt_txt_info_admin_flow_launch_desc:
      'Convert a lobby into a tournament with one click. Select the format (Group + Play-off, Mexicano, or Direct Play-offs). Set the group sizes, the court names, and the scoring rules. The app adds all registered players automatically. Each player keeps the same passphrase, so codes that you printed or sent by email before the event stay valid.',
    txt_txt_info_admin_flow_launch_title: '2) Launch',
    txt_txt_info_admin_flow_prepare_desc:
      'You can create a tournament directly with a fixed list of players. Or you can first open a registration lobby to collect players before the event. A lobby has these functions: custom questions (for example, skill level or availability), an optional join code that controls who can sign up, a public list of registered players, and co-editors who help you manage the registrations.',
    txt_txt_info_admin_flow_prepare_title: '1) Prepare',
    txt_txt_info_admin_flow_rounds_desc:
      'Generate pairings, assign courts, and enter or edit scores during each round. For Mexicano, compare the proposed pairing sets and select the best balance before you confirm. If the format allows it, you can replace players during the event. When the group rounds finish, start the play-offs and seed the bracket. At this step, you can add wildcards or late entries.',
    txt_txt_info_admin_flow_rounds_title: '4) Run rounds',
    txt_txt_info_admin_flow_team_desc:
      'Invite co-editors. Co-editors have full access to the event operations: pairings, scores, and announcements. Some actions are only for the owner and the platform admins: delete the tournament, manage player passphrases, and change the core settings.',
    txt_txt_info_admin_flow_team_title: '5) Work with your team',
    txt_txt_info_admin_flow_title: 'Steps for organizers',
    txt_txt_info_comm_clubs_club_desc:
      'A club is built on one community. It adds a logo, player tiers, seasons, leaderboards, tools to assign tournaments, and co-editor tools for organizer teams that run regular events.',
    txt_txt_info_comm_clubs_club_title: 'Clubs add identity and progression',
    txt_txt_info_comm_clubs_practice_desc:
      'First, create communities to set the structure. Then change the active communities into clubs. Assign each event to the correct season. Keep the default community and the player lists up to date when you add more events.',
    txt_txt_info_comm_clubs_practice_title: 'Recommended setup pattern',
    txt_txt_info_comm_clubs_scope_change_desc:
      'You can move tournaments and lobbies to a different community, for example to clean up or migrate data. If the new community does not match the current club or season, the app removes those assignments automatically. This keeps the scope data valid.',
    txt_txt_info_comm_clubs_scope_change_title: 'Scope changes and data integrity',
    txt_txt_info_comm_clubs_scope_desc:
      'Tournaments and registration lobbies belong to a community. A community sets the default assignment of new events. It keeps the events of each league or venue separate. It also sets the scope of the ELO ratings and rankings: global, community, or club.',
    txt_txt_info_comm_clubs_scope_title: 'Communities set the scope',
    txt_txt_info_comm_clubs_subtitle:
      'Use communities as the base level. Add a club when you need branding, seasons, and more club tools.',
    txt_txt_info_comm_clubs_title: 'Communities and clubs',
    txt_txt_info_comm_clubs_upgrade_desc:
      'Create a club when the same organizer team runs regular events. A club gives a permanent identity, control of the player list, co-editor tools, and continuity across seasons. Also use a club for tier-based progression and for club leaderboards.',
    txt_txt_info_comm_clubs_upgrade_title: 'When to upgrade to a club',
    txt_txt_info_comm_clubs_when_desc:
      'Use only communities if you run occasional events, short series, or simple sign-ups. You still get all tournament functions, lobby conversion, and the TV and public pages. You do not have to maintain a club player list.',
    txt_txt_info_comm_clubs_when_title: 'When to stay at community level',
    txt_txt_info_demo_full_desc:
      'The public demo site runs the full app. Log in with the shared admin account to use all features: registration lobbies, clubs, communities, the Player Hub, custom addresses, and more. All visitors share the same data. The site deletes this data at regular intervals. Do not use the demo site for real events.',
    txt_txt_info_demo_full_title: 'Full demo (shared admin login)',
    txt_txt_info_demo_sandbox_desc:
      'On the main site, the login dialog has the link “Open the demo sandbox”. This link opens a separate practice site, which immediately creates a personal <code>demo-xxxxxx</code> account for you. You do not have to sign up. The site generates a passphrase, which is the password of the account. Save the passphrase to log in again from this device or from a different device. On this device, the login dialog of the demo site shows your account name when you come back. A sandbox has a limited set of admin functions: one active tournament at a time, and no registration lobbies, clubs, communities, custom addresses, or Player Hub profiles. The app deletes the account and all its data a few days after you create it (3 days by default).',
    txt_txt_info_demo_sandbox_desc_instance:
      'On the main site, the login dialog has the link “Open the demo sandbox”. This link opens a separate practice site, which immediately creates a personal <code>demo-xxxxxx</code> account for you. You do not have to sign up. The site generates a passphrase, which is the password of the account. Save the passphrase to log in again from this device or from a different device. On this device, the login dialog of the demo site shows your account name when you come back. A sandbox has a limited set of admin functions: one active tournament at a time, and no registration lobbies, custom addresses, or Player Hub profiles. The app deletes the account and all its data a few days after you create it (3 days by default).',
    txt_txt_info_demo_sandbox_title: 'Throwaway demo account',
    txt_txt_info_demo_title: 'Demo mode',
    txt_txt_info_elo_clamp_desc:
      'A winner always gets at least +1 ELO. A loser always loses at least −1 ELO. This rule applies for all margins and expected scores, so each match result changes the rating.',
    txt_txt_info_elo_clamp_title: 'Minimum delta',
    txt_txt_info_elo_doubles_desc:
      'The expected score uses the <em>average rating of each team</em>. A partner-strength multiplier corrects for pairs with different ratings. If a strong player has a weaker partner, wins give more points and losses cost fewer points. The opposite applies to a weaker player with a stronger partner. The multiplier is between 0.5× and 1.5×.',
    txt_txt_info_elo_doubles_title: 'Doubles (2v2) adjustment',
    txt_txt_info_elo_formula_desc:
      'The actual score is not only a win or a loss. It combines a result value <em>W</em> with a margin ratio <em>R</em>. Thus a close win and a large win give different rating changes.',
    txt_txt_info_elo_formula_legend:
      '<em>yours</em> = your points. <em>opp</em> = the points of your opponent. <em>W</em> = result: win, draw, or loss (1, 0.5, or 0). <em>R</em> = margin ratio. <em>α</em> = blend weight (0.5). The 0.5 in the <em>R</em> formula is a centering constant: a draw gives R = 0.5. This constant is not related to <em>α</em>.',
    txt_txt_info_elo_formula_s_note:
      '<em>S</em> is the blended actual score. It replaces the simple win/loss value in the classic ELO formula. A higher <em>S</em> means a better result. The ELO calculation compares <em>S</em> with the expected score. The difference sets how much your rating changes.',
    txt_txt_info_elo_formula_title: 'Blended outcome',
    txt_txt_info_elo_kfactor_desc:
      'Ratings of new players change faster: K = 40 for the first 20 matches, K = 20 up to 40 matches, and K = 10 after that. New players get to their correct level quickly, and the ratings of experienced players stay stable.',
    txt_txt_info_elo_kfactor_title: 'K-factor tiers',
    txt_txt_info_elo_reliability_desc:
      'The rating of an opponent with very few matches is not reliable. When an <em>established</em> player (20 or more matches) plays such an opponent, a <em>reliability factor</em> decreases the rating change. This prevents large rating changes that come from provisional opponents. Provisional players always get the full rating change, so their ratings settle quickly.',
    txt_txt_info_elo_reliability_legend:
      '<em>n</em> = number of completed matches of the opponent. The factor applies only to established players (20 or more matches). With 0 opponent matches, the change is 30% of the normal value. With 20 opponent matches, the change is 100%. In doubles, the app uses the lower reliability of the two opponents.',
    txt_txt_info_elo_reliability_title: 'Reliability dampener',
    txt_txt_info_elo_subtitle:
      'An ELO engine measures the skill of each player across tournaments. The engine uses the score margin, not only the result. Ratings change after each completed match, and the Player Hub shows them.',
    txt_txt_info_elo_title: 'ELO rating system',
    txt_txt_info_elo_update_desc:
      'After each match, the app compares your blended result <em>S</em> with your expected score <em>E</em>. If your result is better than expected, your rating goes up. If your result is worse than expected, your rating goes down.',
    txt_txt_info_elo_update_legend:
      '<em>E</em> = expected score (0–1), from the rating difference. Against a higher-rated opponent, your <em>E</em> is lower, so a win against a stronger player gives more points. When <em>S</em> &gt; <em>E</em>, your rating goes up. When <em>S</em> &lt; <em>E</em>, your rating goes down. <em>K</em> sets the maximum change per match (see K-factor tiers below).',
    txt_txt_info_elo_update_title: 'Rating update',
    txt_txt_info_formats_elim_desc:
      '<p>Single and double elimination are available in all formats with play-offs. Espejo is available in Group + Play-off and in Direct Play-offs, but not in Mexicano.</p><ul><li><strong>Single elimination (knockout):</strong> a player or team that loses one match is out.</li><li><strong>Double elimination:</strong> a parallel losers’ bracket gives each player or team a second chance. A finalist must lose two times to be out, so consistency across the full draw is important.</li><li><strong>Espejo:</strong> a consolation bracket for the players who lost in round 1. The two brackets run separately. The champion of the winners’ bracket is the tournament champion. The winner of the consolation bracket is the consolation winner. The event finishes when both brackets are complete.</li></ul>',
    txt_txt_info_formats_elim_title: 'Single, double and Espejo elimination',
    txt_txt_info_formats_gp_desc1:
      'The app puts the players into groups, and each group plays a round-robin. Then the best players or teams of each group go to a knockout bracket. This format supports padel scoring and tennis scoring.',
    txt_txt_info_formats_gp_desc2:
      '<ul><li><strong>Team mode:</strong> fixed pairs play against all other pairs in their group (a full round-robin).</li><li><strong>Player (Americano) mode:</strong> partners change each round, so each player plays with every other player at least once. The app makes the matchups of each round from the current group standings, so that each round stays competitive.</li></ul>',
    txt_txt_info_formats_gp_title: 'Group + Play-off',
    txt_txt_info_formats_mex_desc1:
      'The app generates the pairings of each round from the current standings. Leaders play against leaders, and lower-ranked players play against players of a similar rank. In each round, the organizer can compare several proposed pairing sets and select the best balance. The number of rounds can be unlimited (you stop when you want) or fixed.',
    txt_txt_info_formats_mex_desc2:
      'The <em>Advanced Settings</em> give detailed control of scoring and pairing:',
    txt_txt_info_formats_mex_list:
      '<ul><li><strong>Skill gap</strong> — the maximum rating difference in one group. If you leave it blank, the app uses snake-draft order.</li><li><strong>Win bonus</strong> — extra points for the winner on the leaderboard. The app adds them to the game points.</li><li><strong>Rival strength (0–1)</strong> — a bonus for playing against strong opponents, from their average score. A higher value gives a larger effect.</li><li><strong>Loss discount (0–1)</strong> — a multiplier for the points of the losing team. Example: with 0.75, a 12–20 loss gives 9 points, not 12.</li><li><strong>Balance tolerance</strong> — the difference in team strength that the pairing engine can accept to prevent repeated matchups.</li><li><strong>Teammate / opponent repeat weights</strong> — penalties when a player has the same partner or opponent again. Higher values give more varied combinations.</li><li><strong>Repeat decay</strong> — makes old repeats count less than recent repeats.</li><li><strong>Partner balance weight</strong> — a penalty for partners with very different skill levels.</li></ul>',
    txt_txt_info_formats_mex_title: 'Mexicano + Play-offs',
    txt_txt_info_formats_po_desc:
      'Start directly with a bracket. Seed the players in the order that you want, and the app generates the bracket immediately. You do not need a group stage. Use this format for knockout events or for draws with fully custom seeding.',
    txt_txt_info_formats_po_title: 'Direct Play-offs',
    txt_txt_info_formats_schema_desc:
      'Use the schema generator below to see the full bracket structure before you create an event. You can export the diagram as PNG, SVG, or PDF.',
    txt_txt_info_formats_schema_title: 'Bracket schema preview',
    txt_txt_info_formats_title: 'Tournament formats',
    txt_txt_info_github_link: 'Full documentation on GitHub →',
    txt_txt_info_glance_designed_desc:
      'The app has three tournament formats: Group + Play-off, Mexicano, and Direct Play-offs. It also has co-editors, score entry by players, announcements, and links that you can share. When you convert a registration lobby into a tournament, all player passphrases stay the same.',
    txt_txt_info_glance_designed_title: 'Formats and tools',
    txt_txt_info_glance_no_accounts_desc:
      'Players do not create a username or a password. The app gives each player a unique passphrase: a short sequence of words. The passphrase opens the personal match view, score entry, and the Player Hub. The organizer can give the passphrase as a printed card, as a QR code, or by email.',
    txt_txt_info_glance_no_accounts_title: 'No accounts needed for players',
    txt_txt_info_glance_pages_desc:
      '<ul><li><strong>Admin</strong> — the control panel for organizers. Use it to create tournaments and lobbies, manage rounds and scores, and work with your team.</li><li><strong>TV View</strong> — a public page at <code>/tv/&lt;id&gt;</code> that shows live standings, results, and the bracket. Nobody has to log in to see it. A player can log in on this page with a passphrase. The player can then enter the scores of their own matches. This works only when the organizer allows it. Show the page on a large screen or send the link to all players.</li><li><strong>Registrations</strong> — a sign-up page. Players register themselves and answer your questions before the event starts.</li><li><strong>Player Hub</strong> — the personal dashboard of each player at <code>/player</code>. It shows all active and past events of the player under one passphrase.</li></ul>',
    txt_txt_info_glance_pages_title: 'The four pages',
    txt_txt_info_glance_title: 'At a glance',
    txt_txt_info_help_title: 'Docs & support',
    txt_txt_info_issue_link: 'Open an issue on GitHub',
    txt_txt_info_issue_prefix:
      'Did you find a bug or unexpected behavior, or do you have a suggestion?',
    txt_txt_info_main_features_access_desc:
      'Each player logs in with a QR code or a passphrase. Then the player sees their own matches and can enter scores.',
    txt_txt_info_main_features_access_title: 'Player access and self-scoring',
    txt_txt_info_main_features_live_desc:
      'Round management, score entry, match comments, announcements, and changes to the player list during the event (in formats that support it).',
    txt_txt_info_main_features_live_title: 'Live operations',
    txt_txt_info_main_features_reg_desc:
      'Custom questions, review of registrations, co-editors, and conversion into a tournament with one click.',
    txt_txt_info_main_features_reg_title: 'Registration lobbies',
    txt_txt_info_main_features_title: 'Main features',
    txt_txt_info_main_features_tv_desc:
      'A live page that you can share. It shows standings, results, the bracket, and the other sections that you select. You can set how often the page refreshes.',
    txt_txt_info_main_features_tv_title: 'Public TV View',
    txt_txt_info_main_features_pay_title: 'Payments',
    txt_txt_info_main_features_pay_desc:
      '<p>The app does not process money. It records which players paid the organizer or the club directly.</p><ul><li>Set a fee for each player. Add the payment methods: Bizum, IBAN, Revolut, PayPal, cash, or free text.</li><li>Each player has one status: unpaid, reported, paid, no charge, refund due, or refunded. Players can report a payment in their Player Hub.</li><li>Send a reminder by email to all players who did not pay.</li><li>Each player has a transfer reference, for example <code>PADEL-SUMMER-ANA</code>. The reference connects each bank transfer to a name.</li></ul><p>Open Tournament settings → Payments. A registration lobby has the same panel.</p>',
    txt_txt_info_main_features_withdraw_title: 'Withdrawals',
    txt_txt_info_main_features_withdraw_desc:
      '<p>When a player or team leaves during the event, open the Players tab of the tournament and click Withdraw. The dialog shows what changes before you confirm.</p><ul><li><strong>Group stage:</strong> if the participant played fewer than half of its group matches, the app cancels all its group results. If the participant played half or more, the played results stay. The remaining matches become walkovers.</li><li><strong>Rotating partners (Americano):</strong> the player does not play in the following rounds.</li><li><strong>Play-offs:</strong> the pending match becomes a walkover, and the opponent advances.</li><li>Walkovers count in the standings. The ELO system does not rate them.</li></ul><p>You can undo some group-stage withdrawals. You cannot undo a play-off withdrawal.</p>',
    txt_txt_info_player_flow_access_desc:
      'When the tournament starts, players enter their passphrase or scan their QR code. This opens their personal match view. The view shows only their own pairings, courts, standings, and score entry. The organizer can give the passphrase as a printed card, as a QR code, or by email.',
    txt_txt_info_player_flow_access_title: '2) Open your personal area',
    txt_txt_info_player_flow_hub_desc1:
      'A player can create a Player Hub profile at <a href="/player">/player</a> with only an email address. The profile gives the player one permanent passphrase for all events. When the player registers for a lobby, the app fills in the name, email, and contact automatically. When the tournament starts, it shows on the Hub dashboard together with all other active and past events of the player.',
    txt_txt_info_player_flow_hub_desc2:
      'The Hub also shows career statistics: matches played, win rate, and best rank. You can also see your history with one specific player across all tournaments: the matches as partners, the matches as opponents, and your win rate in each case.',
    txt_txt_info_player_flow_hub_desc3:
      'A player without a Hub profile can still link past events. To link an event, enter the passphrase that you received for that event.',
    txt_txt_info_player_flow_hub_title: '5) Player Hub: one passphrase for all events',
    txt_txt_info_player_flow_informed_desc:
      'Announcements, match comments, and optional email updates give the same information to all players during the event.',
    txt_txt_info_player_flow_informed_title: '4) Get updates',
    txt_txt_info_player_flow_join_desc:
      'Players register through a lobby. A lobby is on a public list, or it needs a join code. Players answer the questions that the organizer wrote. At registration, each player gets a unique passphrase: a short sequence of words. This passphrase is the personal key of the player in all parts of the app.',
    txt_txt_info_player_flow_join_title: '1) Join',
    txt_txt_info_player_flow_participate_desc:
      'Players can see the live standings, their next pairings, and their courts. If the organizer enables it, players can also enter or confirm scores from their own view. This decreases the work of the organizer during the event.',
    txt_txt_info_player_flow_participate_title: '3) Play',
    txt_txt_info_player_flow_title: 'Steps for players',
    txt_txt_info_po_trans_ext_desc:
      'In both formats, you can add participants who did not play the qualifying stage. Put them directly into any seed slot of the bracket and give them a score manually. Use this for seeded wildcards, guests, or late registrations.',
    txt_txt_info_po_trans_ext_title: 'External and late-entry participants',
    txt_txt_info_po_trans_gp_desc:
      'When all group matches are complete, the <em>Start Play-offs</em> button shows. Click it to get a recommended list of qualified players, in the order of the group standings. Select or clear any player to change the list. You can add <em>external / seeded participants</em> with a name and a score, for example wildcards or late entries that did not play the group stage. Select single elimination, double elimination, or Espejo, and confirm. The order of the selected players sets the bracket seeding.',
    txt_txt_info_po_trans_gp_title: 'From Group + Play-off',
    txt_txt_info_po_trans_mex_desc:
      'Play-offs are optional. You can start them after any Mexicano round. When you start them, a team builder opens. Each seed slot of the bracket has player drop-down lists, which the app fills in from the leaderboard ranking. In <em>individual mode</em>, select two players for each slot to make one bracket team. The app shows their combined leaderboard score to help you. In <em>team mode</em>, each slot contains one existing team. You can replace any slot with an external participant. When all slots are correct, select single elimination, double elimination, or Espejo, and start the bracket.',
    txt_txt_info_po_trans_mex_title: 'From Mexicano',
    txt_txt_info_po_trans_title: 'Starting play-offs from group stage or Mexicano',
    txt_txt_info_qs_step1_desc:
      'On the Admin home page, click New tournament. Select a format (Group + Play-off, Mexicano, or Direct Play-offs) and a sport. Enter the names of the players or teams and the names of the courts. For Mexicano, also enter the points per match. The scoring and pairing settings of each format are in the Advanced settings section of the same form. Click Create tournament.',
    txt_txt_info_qs_step1_title: '1) Create the event',
    txt_txt_info_qs_step2_desc:
      'Open the tournament and click the Players tab. Each player has a passphrase (for example, brave-little-tiger) and a QR code. You can print the QR cards, copy one code, or send all codes by email. A player needs only this code to see their matches and enter scores. Players do not need an account.',
    txt_txt_info_qs_step2_title: '2) Give players their codes',
    txt_txt_info_qs_step3_desc:
      'Open <code>/tv/&lt;id&gt;</code> on a large screen, or send the link to the players. You can also set a custom alias for this address. The page shows live standings, courts, and the bracket. Nobody has to log in to see it. Open Tournament settings → TV screen to select the sections that the page shows. To let players enter their own scores, use Tournament settings → Scoring → Player scoring.',
    txt_txt_info_qs_step3_title: '3) Put it on a screen',
    txt_txt_info_qs_step4_desc:
      'Enter the scores when the matches finish. In Mexicano, confirm the proposed pairings of each round to go to the next round. Before you confirm, you can look at the alternative pairing sets. If the format allows it, you can add or remove players during the event.',
    txt_txt_info_qs_step4_title: '4) Run the rounds',
    txt_txt_info_qs_step5_desc:
      'When the group stage or the Mexicano rounds are complete, click Start Play-offs to seed the bracket. In this step, you can also add wildcards or late entries. When the tournament has a champion, export a self-contained summary as an HTML or PDF file. The summary contains the bracket and all match results.',
    txt_txt_info_qs_step5_title: '5) Finish',
    txt_txt_info_qs_title: 'Run your first tournament',
    txt_txt_info_qs_where_list:
      '<ul><li><strong>Mexicano settings</strong> — Advanced settings in the New tournament form. After you create the tournament: Tournament settings → Courts and pairing.</li><li><strong>Player passphrases and QR codes</strong> — the Players tab of the tournament.</li><li><strong>Sections of the public view</strong> — Tournament settings → TV screen.</li><li><strong>Score entry by players</strong> — Tournament settings → Scoring → Player scoring.</li></ul>',
    txt_txt_info_qs_where_title: 'Where things live',
    txt_txt_info_tab_desc:
      'This page tells you what the app does and where to find each function. The sections below describe the four pages, the steps for players and organizers, the tournament formats, and the rating system.',
    txt_txt_info_toc_admin_flow: 'Steps for organizers',
    txt_txt_info_toc_communities_clubs: 'Communities & clubs',
    txt_txt_info_toc_demo: 'Demo mode',
    txt_txt_info_toc_elo: 'ELO rating system',
    txt_txt_info_toc_formats: 'Tournament formats',
    txt_txt_info_toc_glance: 'At a glance',
    txt_txt_info_toc_help: 'Docs & support',
    txt_txt_info_toc_main_features: 'Main features',
    txt_txt_info_toc_player_flow: 'Steps for players',
    txt_txt_info_toc_po_transition: 'Starting play-offs',
    txt_txt_info_toc_quickstart: 'Getting started',
    txt_txt_info_toc_title: 'Table of contents',
    txt_txt_tournament_bracket_schema: 'Tournament bracket schema',
  },
  es: {
    txt_txt_info: 'Info',
    txt_txt_info_admin_flow_comm_desc:
      'Publica anuncios que aparecen en la vista de cada jugador y en la pantalla TV. Envía notificaciones por email dirigidas a todos los jugadores o a personas seleccionadas. Una vez finalizado el evento, exporta un resumen en HTML o PDF con el cuadro completo y el historial de partidos, y luego archiva el torneo para mantener la lista ordenada.',
    txt_txt_info_admin_flow_comm_title: '6) Comunicar y cerrar',
    txt_txt_info_admin_flow_creds_desc:
      'En la página del torneo, abre la pestaña Jugadores para ver, copiar, descargar o imprimir todas las contraseñas como tarjetas QR listas para entregar. También puedes enviar credenciales individualmente o de forma masiva por email directamente desde esa pestaña. Los jugadores pueden vincular opcionalmente su contraseña a su perfil de Player Hub para acceso entre eventos.',
    txt_txt_info_admin_flow_creds_title: '3) Distribuir credenciales',
    txt_txt_info_admin_flow_launch_desc:
      'Convierte un lobby en un torneo en directo con un solo clic — elige el formato (Grupo+Playoff, Mexicano o Playoffs directos), establece tamaños de grupo, nombres de pistas y reglas de puntuación. Todos los jugadores registrados se rellenan automáticamente y la contraseña de cada jugador se mantiene sin cambios, por lo que las credenciales impresas o enviadas por email antes del evento siguen siendo válidas.',
    txt_txt_info_admin_flow_launch_title: '2) Lanzar',
    txt_txt_info_admin_flow_prepare_desc:
      'Crea un torneo directamente con una lista fija de participantes, o abre primero un lobby de registro para reunir participantes antes del evento. Los lobbies admiten cuestionarios personalizados (nivel, disponibilidad, etc.), código de acceso opcional para restringir quién puede inscribirse, lista pública de participantes para que cada jugador vea quién más está apuntado, y coeditores para ayudar a gestionar las inscripciones.',
    txt_txt_info_admin_flow_prepare_title: '1) Preparar',
    txt_txt_info_admin_flow_rounds_desc:
      'Genera emparejamientos, asigna pistas y registra o edita puntuaciones a medida que avanza cada ronda. Para Mexicano, revisa varios conjuntos de emparejamientos propuestos y elige el mejor equilibrio antes de confirmar. Las herramientas de plantilla durante el evento permiten sustituciones donde el formato lo permita. Cuando terminen las rondas de grupos, activa los play-offs y siembra el cuadro — añadiendo wildcards o inscripciones tardías si es necesario.',
    txt_txt_info_admin_flow_rounds_title: '4) Gestionar rondas',
    txt_txt_info_admin_flow_team_desc:
      'Invita a coeditores que obtienen acceso operativo completo (emparejamientos, resultados, anuncios), mientras que las acciones sensibles de propiedad — eliminar el torneo, gestionar credenciales, cambiar la configuración principal — quedan restringidas al propietario y los administradores de la plataforma.',
    txt_txt_info_admin_flow_team_title: '5) Coordinar el equipo',
    txt_txt_info_admin_flow_title: 'Recorrido del administrador',
    txt_txt_info_comm_clubs_club_desc:
      'Un club se apoya en una comunidad y añade marca con logo, niveles de jugadores, seguimiento de temporadas, vistas de clasificación, herramientas de asignación de torneos y flujos de coedición para equipos organizadores recurrentes.',
    txt_txt_info_comm_clubs_club_title: 'Los clubes añaden identidad y progresión',
    txt_txt_info_comm_clubs_practice_desc:
      'Crea primero las comunidades (estructura), promociona las activas a clubes, asigna eventos a la temporada correcta y mantén actualizados la comunidad por defecto y los datos de plantilla.',
    txt_txt_info_comm_clubs_practice_title: 'Patrón recomendado de configuración',
    txt_txt_info_comm_clubs_scope_change_desc:
      'Puedes reasignar torneos y lobbies a otra comunidad para limpieza o migración. Si la nueva comunidad es incompatible con el club o la temporada actuales, esas asignaciones se limpian automáticamente para mantener válidas las relaciones de alcance.',
    txt_txt_info_comm_clubs_scope_change_title: 'Cambios de alcance e integridad de datos',
    txt_txt_info_comm_clubs_scope_desc:
      'Una comunidad es donde viven los torneos y lobbies de inscripción. Controla la asignación por defecto, separa operaciones por liga o sede y define el alcance donde se calcula el ELO y las clasificaciones (global, comunidad o club).',
    txt_txt_info_comm_clubs_scope_title: 'Las comunidades definen el alcance operativo',
    txt_txt_info_comm_clubs_subtitle:
      'Usa las comunidades como alcance base y añade clubes cuando necesites marca, seguimiento de temporadas y operaciones avanzadas del club.',
    txt_txt_info_comm_clubs_title: 'Comunidades y clubes',
    txt_txt_info_comm_clubs_upgrade_desc:
      'Crea un club cuando el mismo equipo organizador realiza eventos recurrentes y necesita identidad persistente, gestión de plantilla de jugadores, flujos de colaboradores y continuidad de temporada. Los clubes también son el lugar adecuado para progresión por niveles y gestión de rankings por club.',
    txt_txt_info_comm_clubs_upgrade_title: 'Cuándo pasar a club',
    txt_txt_info_comm_clubs_when_desc:
      'Usa solo comunidades cuando organizas eventos ocasionales, series temporales o flujos de inscripción ligeros. Sigues teniendo operaciones completas de torneo, conversión desde registros y vista TV/pública sin mantener estructuras de plantilla de club.',
    txt_txt_info_comm_clubs_when_title: 'Cuándo quedarse a nivel comunidad',
    txt_txt_info_demo_full_desc:
      'El sitio de demo público ejecuta la app completa. Inicia sesión con la cuenta admin compartida para usar todas las funciones — lobbies de registro, clubes, comunidades, el Player Hub, direcciones personalizadas y más. Los datos se comparten entre visitantes y se reinician periódicamente, así que no lo uses para eventos reales.',
    txt_txt_info_demo_full_title: 'Demo completa (login admin compartido)',
    txt_txt_info_demo_sandbox_desc:
      'En el sitio principal, “Abrir la demo” en el diálogo de inicio de sesión te lleva a un sitio de prueba aparte, que te crea al instante una cuenta personal <code>demo-xxxxxx</code> — sin registro. Su contraseña generada es la clave: guárdala para volver a entrar desde este u otro dispositivo (en este dispositivo, el diálogo de inicio de sesión de la demo te recibe por tu nombre). Una demo tiene un panel de administración mínimo: un torneo activo a la vez, y sin lobbies de registro, clubes, comunidades, direcciones personalizadas ni perfiles de Player Hub. La cuenta y todo lo que crea se eliminan automáticamente unos días después del registro (3 por defecto).',
    txt_txt_info_demo_sandbox_desc_instance:
      'En el sitio principal, “Abrir la demo” en el diálogo de inicio de sesión te lleva a un sitio de prueba aparte, que te crea al instante una cuenta personal <code>demo-xxxxxx</code> — sin registro. Su contraseña generada es la clave: guárdala para volver a entrar desde este u otro dispositivo (en este dispositivo, el diálogo de inicio de sesión de la demo te recibe por tu nombre). Una demo tiene un panel de administración mínimo: un torneo activo a la vez, y sin lobbies de registro, direcciones personalizadas ni perfiles de Player Hub. La cuenta y todo lo que crea se eliminan automáticamente unos días después del registro (3 por defecto).',
    txt_txt_info_demo_sandbox_title: 'Cuenta demo desechable',
    txt_txt_info_demo_title: 'Modo demo',
    txt_txt_info_elo_clamp_desc:
      'Los ganadores siempre ganan al menos +1 ELO y los perdedores siempre pierden al menos −1, independientemente del margen o del resultado esperado. Cada resultado de partido es significativo.',
    txt_txt_info_elo_clamp_title: 'Delta mínimo',
    txt_txt_info_elo_doubles_desc:
      'El resultado esperado usa ratings <em>promedio de equipo</em>. Un multiplicador de fuerza del compañero compensa parejas desiguales: un jugador fuerte emparejado con uno más débil obtiene ganancias amplificadas y pérdidas suavizadas, y viceversa. El multiplicador va de 0,5× a 1,5×.',
    txt_txt_info_elo_doubles_title: 'Ajuste de dobles (2v2)',
    txt_txt_info_elo_formula_desc:
      'En lugar de un simple victoria|derrota, el resultado combina un componente binario <em>W</em> con un ratio continuo de margen <em>R</em>. Las victorias ajustadas y los resultados abultados producen cambios de rating diferentes.',
    txt_txt_info_elo_formula_legend:
      '<em>yours</em> = tus puntos, <em>opp</em> = puntos del rival, <em>W</em> = victoria|empate|derrota (1 | 0,5 | 0), <em>R</em> = ratio de margen, <em>α</em> = peso de mezcla (0,5). El 0,5 en la fórmula de <em>R</em> es una constante de centrado (un empate da R = 0,5) — no está relacionado con <em>α</em>.',
    txt_txt_info_elo_formula_s_note:
      '<em>S</em> es la puntuación real combinada que reemplaza el simple valor victoria/derrota en la fórmula clásica de actualización ELO. Un <em>S</em> más alto indica un resultado más fuerte — el cálculo ELO estándar compara <em>S</em> con la puntuación esperada para determinar cuánto cambia tu rating.',
    txt_txt_info_elo_formula_title: 'Resultado combinado',
    txt_txt_info_elo_kfactor_desc:
      'Los jugadores nuevos se mueven más rápido: K = 40 para los primeros 20 partidos, K = 20 hasta 40 partidos, luego K = 10. Esto permite a los recién llegados encontrar su nivel rápidamente mientras los jugadores experimentados mantienen ratings estables.',
    txt_txt_info_elo_kfactor_title: 'Niveles de factor K',
    txt_txt_info_elo_reliability_desc:
      'Cuando tu rival tiene muy pocos partidos, su rating no es fiable. Para proteger a los jugadores <em>establecidos</em> (≥20 partidos) de cambios grandes causados por rivales provisionales, el cambio de rating se escala con un <em>factor de fiabilidad</em>. Los jugadores provisionales siempre reciben deltas completos para que sus ratings converjan rápidamente.',
    txt_txt_info_elo_reliability_legend:
      '<em>n</em> = partidos completados del rival. El amortiguador solo se activa para jugadores establecidos (≥20 partidos). Con 0 partidos del rival, el delta es el 30% del normal; a los 20 alcanza el 100%. En dobles, se usa la fiabilidad mínima de los dos rivales.',
    txt_txt_info_elo_reliability_title: 'Amortiguador de fiabilidad',
    txt_txt_info_elo_subtitle:
      'Un motor ELO sensible al margen rastrea la habilidad de cada jugador entre torneos. Los ratings se actualizan tras cada partido completado y aparecen en el Player Hub.',
    txt_txt_info_elo_title: 'Sistema de rating ELO',
    txt_txt_info_elo_update_desc:
      'Tras cada partido, tu rating cambia según cómo se compara tu resultado combinado <em>S</em> con la puntuación esperada <em>E</em>. Supera las expectativas y ganas ELO; quédate por debajo y lo pierdes.',
    txt_txt_info_elo_update_legend:
      '<em>E</em> = puntuación esperada (0–1) basada en la diferencia de rating — un rival con más rating tendrá un <em>E</em> mayor para él y menor para ti, así que ganar a un jugador más fuerte se premia más. Cuando <em>S</em> > <em>E</em> tu rating sube; cuando <em>S</em> < <em>E</em> baja. <em>K</em> controla el cambio máximo por partido (ver niveles de factor K abajo).',
    txt_txt_info_elo_update_title: 'Actualización del rating',
    txt_txt_info_formats_elim_desc:
      '<p>La eliminación simple y doble están disponibles en todos los formatos que incluyen play-offs; Espejo está disponible en Grupos + Play-off y en Play-off independiente (no en Mexicano).</p><ul><li><strong>Eliminación simple (knockout):</strong> pierdes una vez y quedas fuera.</li><li><strong>Eliminación doble:</strong> un cuadro paralelo de perdedores da a todos una segunda oportunidad — el finalista debe ser eliminado dos veces para quedar fuera.</li><li><strong>Espejo:</strong> un cuadro de consolación formado por los perdedores de la primera ronda — ambos cuadros corren por separado. El campeón del cuadro de ganadores es el campeón del torneo y el ganador del cuadro de consolación es el ganador de la consolación; el torneo termina cuando ambos cuadros han terminado.</li></ul>',
    txt_txt_info_formats_elim_title: 'Eliminación simple, doble y Espejo',
    txt_txt_info_formats_gp_desc1:
      'Los participantes se dividen en grupos para una fase de liguilla, y los mejores clasificados avanzan a un cuadro de eliminación. Compatible con puntuación de Pádel y Tenis.',
    txt_txt_info_formats_gp_desc2:
      '<ul><li><strong>Modo equipos:</strong> las parejas fijas juegan contra todas las demás del grupo — una liguilla completa.</li><li><strong>Modo jugadores (Americano):</strong> los compañeros rotan cada ronda para que cada jugador forme pareja con todos los demás al menos una vez; los emparejamientos se forman dinámicamente para mantener cada ronda competitiva respecto a la clasificación actual del grupo.</li></ul>',
    txt_txt_info_formats_gp_title: 'Grupo + Play-off',
    txt_txt_info_formats_mex_desc1:
      'Los emparejamientos se generan cada ronda según la clasificación actual: los líderes juegan contra los líderes, los jugadores más débiles contra los de nivel similar. Cada ronda el administrador puede revisar varios conjuntos de emparejamientos propuestos y elegir el mejor equilibrio. Las rondas pueden ser ilimitadas (termina cuando quieras) o fijarse en un número concreto.',
    txt_txt_info_formats_mex_desc2:
      'La sección <em>Ajustes avanzados</em> ofrece control detallado sobre el comportamiento de puntuación y emparejamiento:',
    txt_txt_info_formats_mex_list:
      '<ul><li><strong>Diferencia de nivel</strong> — diferencia máxima de puntuación permitida en un grupo; si se deja vacío, se usa el orden por serpiente.</li><li><strong>Bonus por victoria</strong> — puntos extra añadidos a la puntuación del ganador en la clasificación, además de los puntos brutos del partido.</li><li><strong>Fuerza del rival (0–1)</strong> — bonus que premia enfrentar rivales fuertes (según su puntuación media); mayor peso = mayor efecto.</li><li><strong>Descuento por derrota (0–1)</strong> — multiplicador aplicado a los puntos del perdedor (p. ej., 0,75 significa que perder 12–20 da 9 pts en lugar de 12).</li><li><strong>Tolerancia al equilibrio</strong> — cuánto desequilibrio entre equipos puede aceptar el motor de emparejamiento para evitar repeticiones.</li><li><strong>Pesos de repetición compañero / rival</strong> — penalizaciones por repetir el mismo compañero u oponente; valores más altos empujan al motor hacia combinaciones más variadas.</li><li><strong>Decaimiento de repetición</strong> — decaimiento temporal en las penalizaciones de repetición, de modo que las repeticiones recientes penalizan más que las antiguas.</li><li><strong>Peso de equilibrio de pareja</strong> — penaliza emparejar jugadores con niveles muy diferentes como compañeros.</li></ul>',
    txt_txt_info_formats_mex_title: 'Mexicano + Play-offs',
    txt_txt_info_formats_po_desc:
      'Empieza directamente en un cuadro — siembra a los participantes en el orden deseado y el cuadro se genera de inmediato. No se necesita fase de grupos previa. Útil para eventos de eliminación directa o sorteos completamente personalizados.',
    txt_txt_info_formats_po_title: 'Play-offs Directos',
    txt_txt_info_formats_schema_desc:
      'Usa el generador de esquemas integrado a continuación para visualizar y exportar la estructura completa del cuadro (PNG, SVG o PDF) antes de comprometerte a crear el evento.',
    txt_txt_info_formats_schema_title: 'Vista previa del esquema de cuadro',
    txt_txt_info_formats_title: 'Formatos de torneo',
    txt_txt_info_github_link: 'Documentación completa en GitHub →',
    txt_txt_info_glance_designed_desc:
      'Varios formatos de torneo (Grupo+Playoff, Mexicano, Playoffs directos), coeditores, auto-puntuación de jugadores, anuncios y enlaces compartibles. Convertir un lobby de registro en un torneo en directo transfiere todas las credenciales de jugador sin cambios.',
    txt_txt_info_glance_designed_title: 'Formatos y herramientas',
    txt_txt_info_glance_no_accounts_desc:
      'Los participantes nunca crean usuario ni contraseña. Cada jugador recibe una contraseña única — una secuencia corta de palabras — que da acceso a su vista personal de partidos, registro de puntuaciones y el Player Hub. El organizador puede compartirla como tarjeta impresa, código QR o por email.',
    txt_txt_info_glance_no_accounts_title: 'Los jugadores no necesitan cuentas',
    txt_txt_info_glance_pages_desc:
      '<ul><li><strong>Admin</strong> — el panel de control del organizador para crear torneos y lobbies, gestionar rondas y resultados, y coordinar al equipo.</li><li><strong>Vista TV</strong> — una pantalla pública en <code>/tv/&lt;id&gt;</code> con clasificación en directo, resultados y cuadro. Para verla no hace falta iniciar sesión. Un jugador puede iniciar sesión en esta pantalla con su passphrase para introducir los resultados de sus propios partidos, si el organizador lo permite. Muéstrala en una pantalla grande o comparte el enlace con todos los participantes.</li><li><strong>Registros</strong> — una página de inscripción donde los jugadores se registran con cuestionarios personalizados antes de que empiece el evento.</li><li><strong>Player Hub</strong> — el panel personal de cada participante en <code>/player</code>, que agrupa todos sus eventos activos y pasados bajo una sola contraseña.</li></ul>',
    txt_txt_info_glance_pages_title: 'Las cuatro páginas',
    txt_txt_info_glance_title: 'En un vistazo',
    txt_txt_info_help_title: 'Documentación y soporte',
    txt_txt_info_issue_link: 'Abre un issue en GitHub',
    txt_txt_info_issue_prefix:
      '¿Encontraste un error, comportamiento extraño o tienes una sugerencia?',
    txt_txt_info_main_features_access_desc:
      'Inicio de sesión por QR/contraseña para el contexto personal del partido y registro distribuido de puntuaciones.',
    txt_txt_info_main_features_access_title: 'Acceso de jugadores y auto-puntuación',
    txt_txt_info_main_features_live_desc:
      'Gestión de rondas, seguimiento de puntuaciones, comentarios de partidos, anuncios y herramientas de plantilla durante el evento (donde sea compatible).',
    txt_txt_info_main_features_live_title: 'Operaciones en directo',
    txt_txt_info_main_features_reg_desc:
      'Cuestionarios personalizados, revisión de participantes, coeditores y conversión con un clic a torneos en directo.',
    txt_txt_info_main_features_reg_title: 'Lobbies de inscripción',
    txt_txt_info_main_features_title: 'Funcionalidades principales',
    txt_txt_info_main_features_tv_desc:
      'Pantalla en directo compartible con clasificación, resultados, cuadro y secciones seleccionadas con comportamiento de actualización configurable.',
    txt_txt_info_main_features_tv_title: 'Vista TV pública',
    txt_txt_info_main_features_pay_title: 'Pagos',
    txt_txt_info_main_features_pay_desc:
      '<p>La app no procesa dinero. Solo registra qué jugadores pagaron directamente al organizador o al club.</p><ul><li>Define una cuota por jugador. Añade los métodos de pago: Bizum, IBAN, Revolut, PayPal, efectivo o texto libre.</li><li>Cada jugador tiene un estado: pendiente, comunicado, pagado, sin cargo, devolución pendiente o devuelto. Los jugadores pueden comunicar un pago desde su Player Hub.</li><li>Envía un recordatorio por email a todos los jugadores que no pagaron.</li><li>Cada jugador tiene un concepto de transferencia, por ejemplo <code>PADEL-SUMMER-ANA</code>. El concepto asocia cada transferencia a un nombre.</li></ul><p>Abre Ajustes del torneo → Pagos. Un lobby de inscripción tiene el mismo panel.</p>',
    txt_txt_info_main_features_withdraw_title: 'Bajas',
    txt_txt_info_main_features_withdraw_desc:
      '<p>Cuando un jugador o un equipo se va durante el evento, abre la pestaña Jugadores del torneo y pulsa Dar de baja. El diálogo muestra qué cambia antes de que confirmes.</p><ul><li><strong>Fase de grupos:</strong> si el participante jugó menos de la mitad de sus partidos de grupo, la app anula todos sus resultados de grupo. Si jugó la mitad o más, los resultados jugados se mantienen. Los partidos restantes pasan a W.O.</li><li><strong>Parejas rotativas (Americano):</strong> el jugador no juega las rondas siguientes.</li><li><strong>Play-offs:</strong> el partido pendiente pasa a W.O. y el rival avanza.</li><li>Los W.O. cuentan en la clasificación. El sistema ELO no los puntúa.</li></ul><p>Puedes deshacer algunas bajas de la fase de grupos. No puedes deshacer una baja en los play-offs.</p>',
    txt_txt_info_player_flow_access_desc:
      'Cuando comienza el torneo, los jugadores introducen su contraseña (o escanean un QR) para acceder a su vista personal — emparejamientos, pistas, clasificación y registro de puntuaciones, todo personalizado. El organizador puede compartir la contraseña como tarjeta impresa, código QR o por email.',
    txt_txt_info_player_flow_access_title: '2) Acceder a tu área personal',
    txt_txt_info_player_flow_hub_desc1:
      'Los jugadores pueden configurar su perfil de Player Hub en <a href="/player">/player</a> únicamente con un email. Esto les proporciona una contraseña persistente que funciona en todos los eventos: registrarse en un lobby rellena automáticamente nombre, email y contacto; cuando un torneo comienza, aparece en el panel del Hub junto a todos los eventos activos y pasados.',
    txt_txt_info_player_flow_hub_desc2:
      'El Hub también registra estadísticas de carrera — partidos jugados, porcentaje de victorias, mejor clasificación — y permite explorar el historial con cualquier participante en todos los torneos (con quién jugaste, contra quién y tu porcentaje de victorias en cada combinación).',
    txt_txt_info_player_flow_hub_desc3:
      'Los jugadores que aún no tienen perfil en el Hub pueden vincular eventos individuales de forma retroactiva introduciendo la contraseña que recibieron para ese evento.',
    txt_txt_info_player_flow_hub_title: '5) Player Hub — una contraseña para todo',
    txt_txt_info_player_flow_informed_desc:
      'Los anuncios, comentarios de partidos y actualizaciones opcionales por email mantienen a todos alineados durante el evento.',
    txt_txt_info_player_flow_informed_title: '4) Mantenerse informado',
    txt_txt_info_player_flow_join_desc:
      'Los jugadores se registran a través de un lobby (lista pública o código de acceso) y responden las preguntas definidas por el organizador. Al inscribirse, cada participante recibe una contraseña única — una secuencia corta de palabras — que actúa como su clave personal en la aplicación.',
    txt_txt_info_player_flow_join_title: '1) Unirse',
    txt_txt_info_player_flow_participate_desc:
      'Los jugadores pueden seguir la clasificación en directo, ver sus próximos emparejamientos y pistas asignadas, y (si el organizador lo permite) enviar o confirmar puntuaciones directamente desde su propia vista, reduciendo la carga del administrador durante el evento.',
    txt_txt_info_player_flow_participate_title: '3) Participar',
    txt_txt_info_player_flow_title: 'Recorrido del jugador',
    txt_txt_info_po_trans_ext_desc:
      'Ambos formatos permiten añadir participantes que no estuvieron en la fase clasificatoria directamente en cualquier puesto del cuadro, con una puntuación asignada manualmente. Útil para wildcards sembrados, invitados o inscripciones tardías.',
    txt_txt_info_po_trans_ext_title: 'Participantes externos / de última hora',
    txt_txt_info_po_trans_gp_desc:
      'Cuando todos los partidos pendientes del grupo se han completado, aparece el botón <em>Iniciar Play-offs</em>. Al pulsarlo se obtiene una lista recomendada de participantes que avanzan, ordenados por clasificación de grupo. El administrador puede marcar o desmarcar cualquier participante para ajustar la selección, añadir <em>participantes externos / sembrados</em> por nombre y puntuación (útil para wildcards o inscripciones tardías que se saltan la fase de grupos), elegir eliminación simple, doble o Espejo y confirmar. El orden marcado determina el sembrado del cuadro.',
    txt_txt_info_po_trans_gp_title: 'Desde Grupo + Play-off',
    txt_txt_info_po_trans_mex_desc:
      'Los play-offs son opcionales y pueden activarse en cualquier momento tras cualquier ronda de Mexicano. Al iniciarse, el administrador ve un constructor de equipos donde cada puesto del cuadro tiene menús desplegables de jugadores pre-rellenos según la clasificación. En <em>modo individual</em>, el administrador empareja dos jugadores por puesto para formar un equipo del cuadro — la puntuación combinada de la clasificación se muestra como guía. En <em>modo equipos</em>, cada puesto contiene un equipo ya formado. Cualquier puesto puede ser reemplazado por un participante externo. Una vez confirmados todos los puestos, elige eliminación simple, doble o Espejo y lanza el cuadro.',
    txt_txt_info_po_trans_mex_title: 'Desde Mexicano',
    txt_txt_info_po_trans_title: 'Inicio de play-offs desde la fase de grupos o Mexicano',
    txt_txt_info_qs_step1_desc:
      'En la página de inicio de Admin, pulsa Nuevo torneo y elige un formato (Grupo + Playoff, Mexicano o Playoffs directos) y deporte, luego introduce nombres de jugadores o equipos, nombres de pistas y — para Mexicano — puntos por partido. Los ajustes de puntuación y emparejamiento propios de cada formato están en el desplegable Ajustes avanzados del mismo formulario. Pulsa Crear Torneo.',
    txt_txt_info_qs_step1_title: '1) Crea el evento',
    txt_txt_info_qs_step2_desc:
      'Abre el torneo y pulsa la pestaña Jugadores. Cada jugador tiene una contraseña (p. ej. brave-little-tiger) y un código QR — imprime las tarjetas QR, copia un código o envíalos por email en lote. Ese código es todo lo que un jugador necesita para ver sus partidos y registrar resultados; no hace falta cuenta.',
    txt_txt_info_qs_step2_title: '2) Entrega los códigos a los jugadores',
    txt_txt_info_qs_step3_desc:
      'Abre <code>/tv/&lt;id&gt;</code> (o define un alias personalizado) en una pantalla grande, o envía el enlace a los jugadores — muestra clasificación en directo, pistas y el cuadro sin necesidad de iniciar sesión. Elige qué secciones aparecen en Ajustes del torneo → Pantalla de TV. Para que los jugadores puedan introducir sus propios resultados, usa Ajustes del torneo → Resultados → Resultados de los jugadores.',
    txt_txt_info_qs_step3_title: '3) Ponlo en una pantalla',
    txt_txt_info_qs_step4_desc:
      'Registra resultados a medida que terminan los partidos. En Mexicano, confirma los emparejamientos propuestos de cada ronda para avanzar — revisa antes los conjuntos alternativos si quieres. Puedes añadir o quitar jugadores durante el evento donde el formato lo permita.',
    txt_txt_info_qs_step4_title: '4) Juega las rondas',
    txt_txt_info_qs_step5_desc:
      'Cuando termine la fase de grupos o el Mexicano, pulsa Iniciar playoffs para sembrar el cuadro (añade comodines o inscripciones tardías aquí). Una vez decidido el campeón, exporta un resumen autocontenido en HTML o PDF con el cuadro y el historial completo de partidos.',
    txt_txt_info_qs_step5_title: '5) Cierra',
    txt_txt_info_qs_title: 'Organiza tu primer torneo',
    txt_txt_info_qs_where_list:
      '<ul><li><strong>Ajustes de Mexicano</strong> — Ajustes avanzados en el formulario Nuevo torneo. Una vez creado el torneo: Ajustes del torneo → Pistas y emparejamientos.</li><li><strong>Contraseñas y códigos QR</strong> — la pestaña Jugadores del torneo.</li><li><strong>Secciones de la vista pública</strong> — Ajustes del torneo → Pantalla de TV.</li><li><strong>Resultados introducidos por los jugadores</strong> — Ajustes del torneo → Resultados → Resultados de los jugadores.</li></ul>',
    txt_txt_info_qs_where_title: 'Dónde está cada cosa',
    txt_txt_info_tab_desc:
      'Qué hace esta app y cómo moverte por ella. Usa las secciones de abajo para entender las cuatro páginas, los flujos de jugador y organizador, los formatos de torneo y el sistema de rating.',
    txt_txt_info_toc_admin_flow: 'Recorrido del administrador',
    txt_txt_info_toc_communities_clubs: 'Comunidades y clubes',
    txt_txt_info_toc_demo: 'Modo demo',
    txt_txt_info_toc_elo: 'Sistema de rating ELO',
    txt_txt_info_toc_formats: 'Formatos de torneo',
    txt_txt_info_toc_glance: 'En un vistazo',
    txt_txt_info_toc_help: 'Documentación y soporte',
    txt_txt_info_toc_main_features: 'Funcionalidades principales',
    txt_txt_info_toc_player_flow: 'Recorrido del jugador',
    txt_txt_info_toc_po_transition: 'Inicio de play-offs',
    txt_txt_info_toc_quickstart: 'Primeros pasos',
    txt_txt_info_toc_title: 'Índice de contenidos',
    txt_txt_tournament_bracket_schema: 'Esquema del Cuadro del Torneo',
  },
  ru: {
    txt_txt_info: 'Справка',
    txt_txt_info_admin_flow_comm_desc:
      'Публикуйте объявления. Их видит каждый игрок, они показаны и на экране ТВ. Отправляйте письма всем игрокам или выбранным игрокам. После завершения события экспортируйте автономный отчёт HTML или PDF с полной сеткой и счётом всех матчей. Затем отправьте турнир в архив, чтобы сократить список.',
    txt_txt_info_admin_flow_comm_title: '6) Сообщите итоги и завершите',
    txt_txt_info_admin_flow_creds_desc:
      'На странице турнира откройте вкладку «Игроки». Там можно посмотреть, скопировать, скачать или напечатать все кодовые фразы как карточки с QR-кодами. Также можно отправить кодовые фразы по email одному игроку или всем игрокам. Игроки могут связать кодовую фразу с личным кабинетом. Тогда все их события видны в одном месте.',
    txt_txt_info_admin_flow_creds_title: '3) Отправьте кодовые фразы игрокам',
    txt_txt_info_admin_flow_launch_desc:
      'Преобразуйте лобби в турнир одним нажатием. Выберите формат: группы + плей-офф, Mexicano или прямой плей-офф. Задайте размеры групп, названия кортов и правила счёта. Приложение само добавит всех зарегистрированных игроков. У каждого игрока остаётся та же кодовая фраза, поэтому напечатанные и отправленные коды продолжают работать.',
    txt_txt_info_admin_flow_launch_title: '2) Запуск',
    txt_txt_info_admin_flow_prepare_desc:
      'Можно сразу создать турнир с готовым списком игроков. Или сначала открыть лобби регистрации и собрать заявки. Функции лобби: свои вопросы (например, уровень игры или свободное время), необязательный код регистрации, открытый список игроков и соредакторы, которые помогают управлять заявками.',
    txt_txt_info_admin_flow_prepare_title: '1) Подготовка',
    txt_txt_info_admin_flow_rounds_desc:
      'Составляйте пары, назначайте корты, вводите и изменяйте счёт в каждом раунде. В Mexicano сравните предложенные наборы пар и выберите лучший баланс перед подтверждением. Если формат позволяет, игроков можно заменять во время события. После раундов групп начните плей-офф и задайте посев сетки. На этом шаге можно добавить приглашённых игроков или поздние заявки.',
    txt_txt_info_admin_flow_rounds_title: '4) Проведение раундов',
    txt_txt_info_admin_flow_team_desc:
      'Пригласите соредакторов. Им доступны все действия в событии: пары, счёт и объявления. Только владельцу и администраторам платформы доступно удаление турнира, управление кодовыми фразами и изменение основных настроек.',
    txt_txt_info_admin_flow_team_title: '5) Работа с командой',
    txt_txt_info_admin_flow_title: 'Шаги для организаторов',
    txt_txt_info_comm_clubs_club_desc:
      'Клуб создаётся на основе одного сообщества. Он добавляет логотип, уровни игроков, сезоны, таблицы, инструменты назначения турниров и инструменты соредакторов для команд с регулярными событиями.',
    txt_txt_info_comm_clubs_club_title: 'Клуб добавляет стиль и развитие',
    txt_txt_info_comm_clubs_practice_desc:
      'Сначала создайте сообщества и задайте структуру. Затем преобразуйте активные сообщества в клубы. Назначьте каждому событию правильный сезон. Обновляйте сообщество по умолчанию и списки игроков по мере появления новых событий.',
    txt_txt_info_comm_clubs_practice_title: 'Рекомендуемый порядок настройки',
    txt_txt_info_comm_clubs_scope_change_desc:
      'Турниры и лобби можно перенести в другое сообщество, например для наведения порядка или переноса данных. Если новое сообщество не подходит к текущему клубу или сезону, приложение само уберёт эти назначения. Так данные остаются верными.',
    txt_txt_info_comm_clubs_scope_change_title: 'Смена принадлежности и верность данных',
    txt_txt_info_comm_clubs_scope_desc:
      'Турниры и лобби регистрации принадлежат сообществу. Сообщество задаёт назначение новых событий по умолчанию. Оно разделяет события разных лиг и площадок. Оно также задаёт область рейтинга ELO: общий, сообщество или клуб.',
    txt_txt_info_comm_clubs_scope_title: 'Сообщества задают принадлежность',
    txt_txt_info_comm_clubs_subtitle:
      'Сообщество — базовый уровень. Добавьте клуб, если нужны оформление, сезоны и другие инструменты клуба.',
    txt_txt_info_comm_clubs_title: 'Сообщества и клубы',
    txt_txt_info_comm_clubs_upgrade_desc:
      'Создайте клуб, если одна команда организаторов проводит регулярные события. Клуб даёт постоянный стиль, управление списком игроков, инструменты соредакторов и преемственность между сезонами. Клуб также нужен для развития по уровням и для таблиц клуба.',
    txt_txt_info_comm_clubs_upgrade_title: 'Когда создавать клуб',
    txt_txt_info_comm_clubs_when_desc:
      'Достаточно сообщества, если вы проводите редкие события, короткие серии или простую регистрацию. Вам доступны все функции турниров, преобразование лобби, экран ТВ и открытые страницы. Вести список игроков клуба не нужно.',
    txt_txt_info_comm_clubs_when_title: 'Когда достаточно сообщества',
    txt_txt_info_demo_full_desc:
      'На открытом демо-сайте работает полная версия приложения. Войдите под общим аккаунтом администратора, чтобы использовать все функции: лобби регистрации, клубы, сообщества, личный кабинет, свои адреса и другое. Все посетители видят одни и те же данные. Сайт регулярно удаляет эти данные. Не используйте демо-сайт для настоящих событий.',
    txt_txt_info_demo_full_title: 'Полное демо (общий вход администратора)',
    txt_txt_info_demo_sandbox_desc:
      'На основном сайте в окне входа есть ссылка «Открыть демо». Она открывает отдельный учебный сайт. Сайт сразу создаёт для вас личный аккаунт <code>demo-xxxxxx</code>. Регистрация не нужна. Сайт создаёт кодовую фразу, которая служит паролем аккаунта. Сохраните кодовую фразу, чтобы снова войти с этого или другого устройства. На этом устройстве окно входа демо-сайта покажет имя вашего аккаунта при возвращении. В демо доступны не все функции: один активный турнир за раз; нет лобби регистрации, клубов, сообществ, своих адресов и личного кабинета. Приложение удаляет аккаунт и все его данные через несколько дней после создания (по умолчанию через 3 дня).',
    txt_txt_info_demo_sandbox_desc_instance:
      'На основном сайте в окне входа есть ссылка «Открыть демо». Она открывает отдельный учебный сайт. Сайт сразу создаёт для вас личный аккаунт <code>demo-xxxxxx</code>. Регистрация не нужна. Сайт создаёт кодовую фразу, которая служит паролем аккаунта. Сохраните кодовую фразу, чтобы снова войти с этого или другого устройства. На этом устройстве окно входа демо-сайта покажет имя вашего аккаунта при возвращении. В демо доступны не все функции: один активный турнир за раз; нет лобби регистрации, своих адресов и личного кабинета. Приложение удаляет аккаунт и все его данные через несколько дней после создания (по умолчанию через 3 дня).',
    txt_txt_info_demo_sandbox_title: 'Временный демо-аккаунт',
    txt_txt_info_demo_title: 'Демо-режим',
    txt_txt_info_elo_clamp_desc:
      'Победитель всегда получает минимум +1 ELO. Проигравший всегда теряет минимум −1 ELO. Правило действует при любой разнице и любом ожидаемом итоге, поэтому каждый матч меняет рейтинг.',
    txt_txt_info_elo_clamp_title: 'Минимальное изменение',
    txt_txt_info_elo_doubles_desc:
      'Ожидаемый итог использует <em>средний рейтинг каждой команды</em>. Множитель силы партнёра учитывает разницу рейтингов в паре. Если у сильного игрока более слабый партнёр, победа приносит больше очков, а поражение отнимает меньше. Для слабого игрока с более сильным партнёром всё наоборот. Множитель находится в диапазоне от 0,5× до 1,5×.',
    txt_txt_info_elo_doubles_title: 'Поправка для пар (2 на 2)',
    txt_txt_info_elo_formula_desc:
      'Фактический итог — это не только победа или поражение. Он объединяет значение исхода <em>W</em> и долю разницы <em>R</em>. Поэтому упорная победа и крупная победа меняют рейтинг по-разному.',
    txt_txt_info_elo_formula_legend:
      '<em>yours</em> — ваши очки. <em>opp</em> — очки соперника. <em>W</em> — исход: победа, ничья или поражение (1, 0,5 или 0). <em>R</em> — доля разницы. <em>α</em> — вес смешивания (0,5). Число 0,5 в формуле <em>R</em> — постоянная центрирования: при ничьей R = 0,5. Эта постоянная не связана с <em>α</em>.',
    txt_txt_info_elo_formula_s_note:
      '<em>S</em> — смешанный фактический итог. Он заменяет простое значение победы или поражения в классической формуле ELO. Чем выше <em>S</em>, тем лучше итог. Расчёт ELO сравнивает <em>S</em> с ожидаемым итогом. От разницы зависит изменение рейтинга.',
    txt_txt_info_elo_formula_title: 'Смешанный итог',
    txt_txt_info_elo_kfactor_desc:
      'Рейтинг новых игроков меняется быстрее: K = 40 в первых 20 матчах, K = 20 до 40 матчей и K = 10 после этого. Новые игроки быстро выходят на свой уровень, а рейтинг опытных игроков остаётся стабильным.',
    txt_txt_info_elo_kfactor_title: 'Значения коэффициента K',
    txt_txt_info_elo_reliability_desc:
      'Рейтинг соперника с очень малым числом матчей ненадёжен. Когда <em>опытный</em> игрок (20 матчей и больше) играет с таким соперником, <em>коэффициент надёжности</em> уменьшает изменение рейтинга. Это исключает большие изменения из-за новичков. Новички всегда получают полное изменение рейтинга, поэтому их рейтинг быстро устанавливается.',
    txt_txt_info_elo_reliability_legend:
      '<em>n</em> — число завершённых матчей соперника. Коэффициент действует только для опытных игроков (20 матчей и больше). При 0 матчей соперника изменение составляет 30% от обычного. При 20 матчах соперника — 100%. В парах приложение берёт меньшую надёжность из двух соперников.',
    txt_txt_info_elo_reliability_title: 'Поправка на надёжность',
    txt_txt_info_elo_subtitle:
      'Система ELO измеряет силу каждого игрока на всех турнирах. Она учитывает разницу в счёте, а не только исход. Рейтинг меняется после каждого завершённого матча и показан в личном кабинете.',
    txt_txt_info_elo_title: 'Рейтинг ELO',
    txt_txt_info_elo_update_desc:
      'После каждого матча приложение сравнивает ваш смешанный итог <em>S</em> с ожидаемым итогом <em>E</em>. Если итог лучше ожидаемого, рейтинг растёт. Если хуже — падает.',
    txt_txt_info_elo_update_legend:
      '<em>E</em> — ожидаемый итог (0–1), зависит от разницы рейтингов. Против соперника с более высоким рейтингом ваш <em>E</em> ниже, поэтому победа над сильным соперником приносит больше очков. Когда <em>S</em> &gt; <em>E</em>, рейтинг растёт. Когда <em>S</em> &lt; <em>E</em>, рейтинг падает. <em>K</em> задаёт наибольшее изменение за матч (см. значения коэффициента K ниже).',
    txt_txt_info_elo_update_title: 'Изменение рейтинга',
    txt_txt_info_formats_elim_desc:
      '<p>Олимпийская система и система до двух поражений доступны во всех форматах с плей-офф. Espejo доступен в форматах «группы + плей-офф» и «прямой плей-офф», но не в Mexicano.</p><ul><li><strong>Олимпийская система:</strong> игрок или команда выбывает после первого поражения.</li><li><strong>До двух поражений:</strong> параллельная нижняя сетка даёт каждому второй шанс. Финалист выбывает только после двух поражений, поэтому важна стабильность на всей дистанции.</li><li><strong>Espejo:</strong> дополнительная сетка для тех, кто проиграл в первом круге. Две сетки идут отдельно. Чемпион верхней сетки становится чемпионом турнира. Победитель дополнительной сетки становится её чемпионом. Событие завершается после окончания обеих сеток.</li></ul>',
    txt_txt_info_formats_elim_title: 'Олимпийская система, до двух поражений и Espejo',
    txt_txt_info_formats_gp_desc1:
      'Приложение делит игроков на группы, и каждая группа играет по круговой системе. Затем лучшие игроки или команды каждой группы выходят в сетку на выбывание. Формат поддерживает счёт падела и тенниса.',
    txt_txt_info_formats_gp_desc2:
      '<ul><li><strong>Командный режим:</strong> постоянные пары играют со всеми другими парами группы (полная круговая система).</li><li><strong>Личный режим (Americano):</strong> партнёры меняются каждый раунд, поэтому каждый игрок играет с каждым хотя бы раз. Приложение составляет матчи каждого раунда по текущей таблице группы, чтобы раунды оставались равными.</li></ul>',
    txt_txt_info_formats_gp_title: 'Группы + плей-офф',
    txt_txt_info_formats_mex_desc1:
      'Приложение составляет пары каждого раунда по текущей таблице. Лидеры играют с лидерами, остальные — с игроками близкого места. В каждом раунде организатор может сравнить несколько вариантов пар и выбрать лучший баланс. Число раундов может быть неограниченным (вы завершаете их сами) или постоянным.',
    txt_txt_info_formats_mex_desc2:
      'В разделе <em>Дополнительные настройки</em> можно подробно управлять счётом и парами:',
    txt_txt_info_formats_mex_list:
      '<ul><li><strong>Разница силы</strong> — наибольшая разница рейтинга в одной группе. Если оставить поле пустым, приложение использует распределение змейкой.</li><li><strong>Бонус за победу</strong> — дополнительные очки победителю в таблице. Приложение добавляет их к очкам матча.</li><li><strong>Сила соперника (0–1)</strong> — бонус за матч с сильными соперниками, по их среднему числу очков. Чем больше значение, тем сильнее эффект.</li><li><strong>Скидка за поражение (0–1)</strong> — множитель очков проигравшей команды. Пример: при 0,75 поражение 12–20 даёт 9 очков, а не 12.</li><li><strong>Допуск баланса</strong> — разница силы команд, которую система пар допускает, чтобы избежать повторов.</li><li><strong>Веса повторов партнёра и соперника</strong> — штрафы, когда у игрока тот же партнёр или соперник. Чем больше значение, тем разнообразнее сочетания.</li><li><strong>Затухание повторов</strong> — старые повторы значат меньше новых.</li><li><strong>Вес баланса партнёров</strong> — штраф для партнёров с очень разной силой.</li></ul>',
    txt_txt_info_formats_mex_title: 'Mexicano + плей-офф',
    txt_txt_info_formats_po_desc:
      'Начните сразу с сетки. Задайте нужный посев, и приложение сразу создаст сетку. Групповой этап не нужен. Этот формат подходит для событий на выбывание и для сеток с полностью своим посевом.',
    txt_txt_info_formats_po_title: 'Прямой плей-офф',
    txt_txt_info_formats_schema_desc:
      'Создайте схему ниже, чтобы увидеть полную структуру сетки до создания события. Схему можно экспортировать как PNG, SVG или PDF.',
    txt_txt_info_formats_schema_title: 'Предпросмотр схемы сетки',
    txt_txt_info_formats_title: 'Форматы турниров',
    txt_txt_info_github_link: 'Полная документация на GitHub →',
    txt_txt_info_glance_designed_desc:
      'В приложении три формата турниров: группы + плей-офф, Mexicano и прямой плей-офф. Также есть соредакторы, ввод счёта игроками, объявления и ссылки, которыми можно поделиться. При преобразовании лобби регистрации в турнир кодовые фразы игроков не меняются.',
    txt_txt_info_glance_designed_title: 'Форматы и инструменты',
    txt_txt_info_glance_no_accounts_desc:
      'Игрокам не нужны имя пользователя и пароль. Приложение выдаёт каждому игроку уникальную кодовую фразу из нескольких слов. Она открывает личный список матчей, ввод счёта и личный кабинет. Организатор может передать кодовую фразу на печатной карточке, как QR-код или по email.',
    txt_txt_info_glance_no_accounts_title: 'Игрокам не нужны аккаунты',
    txt_txt_info_glance_pages_desc:
      '<ul><li><strong>Управление</strong> — панель организаторов. Здесь создают турниры и лобби, управляют раундами и счётом, работают с командой.</li><li><strong>Экран ТВ</strong> — открытая страница <code>/tv/&lt;id&gt;</code> с таблицей, счётом и сеткой в реальном времени. Чтобы смотреть её, входить не нужно. Игрок может войти на этой странице по своей кодовой фразе и ввести счёт своих матчей, если организатор это разрешил. Покажите её на большом экране или отправьте ссылку игрокам.</li><li><strong>Регистрация</strong> — страница подачи заявок. Игроки сами регистрируются и отвечают на ваши вопросы до начала события.</li><li><strong>Личный кабинет</strong> — личная страница игрока <code>/player</code>. Там видны все активные и прошлые события игрока под одной кодовой фразой.</li></ul>',
    txt_txt_info_glance_pages_title: 'Четыре страницы',
    txt_txt_info_glance_title: 'Коротко о главном',
    txt_txt_info_help_title: 'Документация и поддержка',
    txt_txt_info_issue_link: 'Сообщить о проблеме на GitHub',
    txt_txt_info_issue_prefix: 'Нашли ошибку или странное поведение, или есть предложение?',
    txt_txt_info_main_features_access_desc:
      'Каждый игрок входит по QR-коду или кодовой фразе. Затем он видит свои матчи и может вводить счёт.',
    txt_txt_info_main_features_access_title: 'Доступ игроков и ввод счёта',
    txt_txt_info_main_features_live_desc:
      'Управление раундами, ввод счёта, комментарии к матчам, объявления и изменение списка игроков во время события (в форматах с такой функцией).',
    txt_txt_info_main_features_live_title: 'Работа во время события',
    txt_txt_info_main_features_reg_desc:
      'Свои вопросы, проверка заявок, соредакторы и преобразование в турнир одним нажатием.',
    txt_txt_info_main_features_reg_title: 'Лобби регистрации',
    txt_txt_info_main_features_title: 'Основные функции',
    txt_txt_info_main_features_tv_desc:
      'Страница в реальном времени, которой можно поделиться. На ней таблица, счёт, сетка и другие выбранные разделы. Можно задать частоту обновления.',
    txt_txt_info_main_features_tv_title: 'Открытый экран ТВ',
    txt_txt_info_main_features_pay_title: 'Оплата',
    txt_txt_info_main_features_pay_desc:
      '<p>Приложение не принимает деньги. Оно только записывает, какие игроки заплатили организатору или клубу напрямую.</p><ul><li>Задайте взнос для каждого игрока. Добавьте способы оплаты: Bizum, IBAN, Revolut, PayPal, наличные или свободный текст.</li><li>У каждого игрока один статус: не оплачено, сообщено, оплачено, без оплаты, нужен возврат или возвращено. Игрок может сообщить об оплате в своём личном кабинете.</li><li>Отправьте напоминание по email всем, кто не заплатил.</li><li>У каждого игрока есть назначение перевода, например <code>PADEL-SUMMER-ANA</code>. По нему каждый перевод связывают с именем.</li></ul><p>Откройте «Настройки турнира» → «Оплата». У лобби регистрации есть такая же панель.</p>',
    txt_txt_info_main_features_withdraw_title: 'Снятие с турнира',
    txt_txt_info_main_features_withdraw_desc:
      '<p>Если игрок или команда уходит во время события, откройте вкладку «Игроки» турнира и нажмите «Снять с турнира». Диалог показывает, что изменится, до подтверждения.</p><ul><li><strong>Групповой этап:</strong> если участник сыграл меньше половины матчей группы, приложение аннулирует все его матчи в группе. Если он сыграл половину или больше, сыгранные матчи остаются. В оставшихся матчах засчитывается техническая победа соперника.</li><li><strong>Меняющиеся партнёры (Americano):</strong> игрок не играет в следующих раундах.</li><li><strong>Плей-офф:</strong> в ожидающем матче засчитывается техническая победа, соперник проходит дальше.</li><li>Технические победы учитываются в таблице. Рейтинг ELO за них не меняется.</li></ul><p>Часть снятий на групповом этапе можно отменить. Снятие в плей-офф отменить нельзя.</p>',
    txt_txt_info_player_flow_access_desc:
      'Когда турнир начат, игроки вводят кодовую фразу или сканируют QR-код. Открывается их личный список матчей. В нём только их пары, корты, таблица и ввод счёта. Организатор может передать кодовую фразу на печатной карточке, как QR-код или по email.',
    txt_txt_info_player_flow_access_title: '2) Откройте личный раздел',
    txt_txt_info_player_flow_hub_desc1:
      'Игрок может создать личный кабинет на странице <a href="/player">/player</a>, указав только email. Игрок получает одну постоянную кодовую фразу для всех событий. При регистрации в лобби приложение само заполняет имя, email и контакт. Когда турнир начнётся, он появится в личном кабинете вместе с другими активными и прошлыми событиями.',
    txt_txt_info_player_flow_hub_desc2:
      'Личный кабинет также показывает статистику: сыгранные матчи, долю побед и лучшее место. Можно посмотреть вашу историю с конкретным игроком на всех турнирах: матчи в паре, матчи друг против друга и долю побед в каждом случае.',
    txt_txt_info_player_flow_hub_desc3:
      'Игрок без личного кабинета тоже может связать прошлые события. Для этого введите кодовую фразу, полученную для события.',
    txt_txt_info_player_flow_hub_title: '5) Личный кабинет: одна кодовая фраза для всех событий',
    txt_txt_info_player_flow_informed_desc:
      'Объявления, комментарии к матчам и письма по желанию дают всем игрокам одну и ту же информацию во время события.',
    txt_txt_info_player_flow_informed_title: '4) Получайте новости',
    txt_txt_info_player_flow_join_desc:
      'Игроки регистрируются через лобби. Лобби находится в открытом списке или требует код регистрации. Игроки отвечают на вопросы организатора. При регистрации каждый игрок получает уникальную кодовую фразу из нескольких слов. Эта кодовая фраза открывает доступ ко всем разделам приложения.',
    txt_txt_info_player_flow_join_title: '1) Подача заявки',
    txt_txt_info_player_flow_participate_desc:
      'Игроки видят текущую таблицу, следующие пары и корты. Если организатор разрешил, игроки сами вводят или подтверждают счёт. Это снижает нагрузку на организатора во время события.',
    txt_txt_info_player_flow_participate_title: '3) Игра',
    txt_txt_info_player_flow_title: 'Шаги для игроков',
    txt_txt_info_po_trans_ext_desc:
      'В обоих форматах можно добавить участников, которые не играли отборочный этап. Поставьте их на любое место посева в сетке и вручную задайте им очки. Это подходит для приглашённых игроков, гостей и поздних заявок.',
    txt_txt_info_po_trans_ext_title: 'Внешние участники и поздние заявки',
    txt_txt_info_po_trans_gp_desc:
      'Когда все матчи групп завершены, появляется кнопка <em>Начать плей-офф</em>. Нажмите её и получите рекомендованный список выходящих игроков в порядке таблиц групп. Чтобы изменить список, выберите игроков или снимите выбор. Можно добавить <em>внешних участников</em> с именем и очками, например приглашённых игроков или поздние заявки. Выберите олимпийскую систему, систему до двух поражений или Espejo и подтвердите. Порядок выбранных игроков задаёт посев сетки.',
    txt_txt_info_po_trans_gp_title: 'Из формата «группы + плей-офф»',
    txt_txt_info_po_trans_mex_desc:
      'Плей-офф необязателен. Его можно начать после любого раунда Mexicano. Откроется конструктор команд. У каждого места посева есть выпадающие списки игроков, заполненные по таблице. В <em>личном режиме</em> выберите двух игроков на место, чтобы получить одну команду сетки. Приложение показывает их суммарные очки. В <em>командном режиме</em> каждое место занимает одна существующая команда. Любое место можно заменить внешним участником. Когда все места заполнены верно, выберите олимпийскую систему, систему до двух поражений или Espejo и начните сетку.',
    txt_txt_info_po_trans_mex_title: 'Из Mexicano',
    txt_txt_info_po_trans_title: 'Начало плей-офф после групп или Mexicano',
    txt_txt_info_qs_step1_desc:
      'На главной странице админки нажмите «Новый турнир». Выберите формат (группы + плей-офф, Mexicano или прямой плей-офф) и вид спорта. Введите имена игроков или команд и названия кортов. Для Mexicano также введите очки за матч. Настройки счёта и пар каждого формата находятся в разделе «Дополнительные настройки» этой же формы. Нажмите «Создать турнир».',
    txt_txt_info_qs_step1_title: '1) Создайте событие',
    txt_txt_info_qs_step2_desc:
      'Откройте турнир и нажмите вкладку «Игроки». У каждого игрока есть кодовая фраза (например, brave-little-tiger) и QR-код. Можно напечатать карточки, скопировать один код или отправить все коды по email. Игроку нужен только этот код, чтобы видеть свои матчи и вводить счёт. Аккаунт не нужен.',
    txt_txt_info_qs_step2_title: '2) Выдайте коды игрокам',
    txt_txt_info_qs_step3_desc:
      'Откройте <code>/tv/&lt;id&gt;</code> на большом экране или отправьте ссылку игрокам. Можно также задать свой адрес. На странице видны таблица, корты и сетка в реальном времени. Входить не нужно. Разделы страницы выберите в «Настройки турнира» → «Экран ТВ». Чтобы игроки сами вводили счёт, откройте «Настройки турнира» → «Счёт» → «Ввод счёта игроками».',
    txt_txt_info_qs_step3_title: '3) Покажите на экране',
    txt_txt_info_qs_step4_desc:
      'Вводите счёт по окончании матчей. В Mexicano подтвердите предложенные пары каждого раунда, чтобы перейти к следующему. Перед подтверждением можно посмотреть другие варианты пар. Если формат позволяет, игроков можно добавлять и убирать во время события.',
    txt_txt_info_qs_step4_title: '4) Проводите раунды',
    txt_txt_info_qs_step5_desc:
      'После группового этапа или раундов Mexicano нажмите «Начать плей-офф», чтобы задать посев сетки. На этом шаге также можно добавить приглашённых игроков или поздние заявки. Когда определится чемпион, экспортируйте автономный отчёт HTML или PDF. В нём есть сетка и счёт всех матчей.',
    txt_txt_info_qs_step5_title: '5) Завершение',
    txt_txt_info_qs_title: 'Проведите первый турнир',
    txt_txt_info_qs_where_list:
      '<ul><li><strong>Настройки Mexicano</strong> — раздел «Дополнительные настройки» формы «Новый турнир». После создания турнира: «Настройки турнира» → «Корты и пары».</li><li><strong>Кодовые фразы и QR-коды игроков</strong> — вкладка «Игроки» турнира.</li><li><strong>Разделы открытой страницы</strong> — «Настройки турнира» → «Экран ТВ».</li><li><strong>Ввод счёта игроками</strong> — «Настройки турнира» → «Счёт» → «Ввод счёта игроками».</li></ul>',
    txt_txt_info_qs_where_title: 'Где что находится',
    txt_txt_info_tab_desc:
      'Здесь описано, что умеет приложение и где найти каждую функцию. Ниже — четыре страницы, шаги для игроков и организаторов, форматы турниров и система рейтинга.',
    txt_txt_info_toc_admin_flow: 'Шаги для организаторов',
    txt_txt_info_toc_communities_clubs: 'Сообщества и клубы',
    txt_txt_info_toc_demo: 'Демо-режим',
    txt_txt_info_toc_elo: 'Рейтинг ELO',
    txt_txt_info_toc_formats: 'Форматы турниров',
    txt_txt_info_toc_glance: 'Коротко о главном',
    txt_txt_info_toc_help: 'Документация и поддержка',
    txt_txt_info_toc_main_features: 'Основные функции',
    txt_txt_info_toc_player_flow: 'Шаги для игроков',
    txt_txt_info_toc_po_transition: 'Начало плей-офф',
    txt_txt_info_toc_quickstart: 'Первые шаги',
    txt_txt_info_toc_title: 'Содержание',
    txt_txt_tournament_bracket_schema: 'Схема турнирной сетки',
  },
};

/** The guide text for a language. Languages without a catalog (Russian until its guide exists)
 * show the English text. */
export function catalogFor(language: string): Record<string, string> {
  return language === 'es' ? CATALOG.es : language === 'ru' ? CATALOG.ru : CATALOG.en;
}
