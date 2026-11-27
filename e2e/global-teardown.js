// After the tests: remove what the test accounts left behind on the live
// database (released holds and their unpaid payment rows, leftover team lists),
// so staff screens and reports stay clean.
const fs = require('fs');
const path = require('path');
const { admin, AUTH_DIR } = require('./lib');

module.exports = async () => {
  const file = path.join(AUTH_DIR, 'tokens.json');
  if (!fs.existsSync(file)) return;
  const tokens = JSON.parse(fs.readFileSync(file, 'utf8'));
  const db = admin();
  for (const t of Object.values(tokens)) {
    const { data: gone } = await db.from('reservations').select('group_id').eq('user_id', t.uid).eq('status', 'canceled');
    const groups = [...new Set((gone || []).map((r) => r.group_id))];
    if (groups.length) {
      await db.from('payments').delete().in('reservation_group_id', groups).neq('status', 'succeeded');
      await db.from('reservations').delete().in('group_id', groups).eq('status', 'canceled');
    }
    const { data: teams } = await db.from('waiver_teams').select('id').eq('owner_id', t.uid);
    const ids = (teams || []).map((x) => x.id);
    if (ids.length) {
      await db.from('waiver_team_players').delete().in('team_id', ids);
      await db.from('waiver_teams').delete().in('id', ids);
    }
  }
};
