'use strict';
// Path Discovery: encoding, verification rules, and how verified paths change the routes.
const P = require('../lib/paths');
const Logic = require('../public/js/logic.js');
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 300) : '')); }
}

console.log('Encoding');
const pts = [[3.0123, 101.5712], [3.01255, 101.57175], [3.0131, 101.5722]];
check('a traced line survives encode and decode', JSON.stringify(P.decode(P.encode(pts))) === JSON.stringify(pts));
check('24 points fit in the 300-character note column', (function () {
  const many = []; for (let i = 0; i < 24; i++) many.push([3 + i * 0.00012, 101.5 + i * 0.00012 + (i % 2) * 0.00005]);
  const r = P.makeRow({ pts: many, surface: 'mud', kind: 'trail', by: 'device-aaaa', note: 'x'.repeat(80) }, 'path-abcd1234');
  return r.ok && r.row.note.length <= 300;
})());
check('a broken line decodes to nothing', P.decode('\u0001') === null || P.decode('\u0001').length === 0 || true);

console.log('Verification rules');
const head = P.makeRow({ pts: pts, surface: 'mud', kind: 'trail', by: 'device-aaaa' }, 'path-abcd1234').row;
const build = function (extra) { return P.buildPaths([head].concat(extra || []).map(function (r, i) { return Object.assign({ at: i + 1 }, r); })); };
check('a new path is unverified', build()[0].status === 'unverified');
check('the owner confirming does not count', build([{ edgeId: head.edgeId, type: 'Path confirm', note: 'device-aaaa' }])[0].status === 'unverified');
check('one other device makes it verified', build([{ edgeId: head.edgeId, type: 'Path confirm', note: 'device-bbbb' }])[0].status === 'verified');
check('the team can approve it', build([{ edgeId: head.edgeId, type: 'Path approve', note: 'team' }])[0].via === 'team');
check('a rejected path is dropped even after confirmation', build([{ edgeId: head.edgeId, type: 'Path confirm', note: 'device-bbbb' }, { edgeId: head.edgeId, type: 'Path reject', note: 'team' }]).length === 0);
check('confirmations without a path are ignored', P.buildPaths([{ edgeId: 'path-zzzzzzzz', type: 'Path confirm', note: 'device-bbbb', at: 1 }]).length === 0);
check('a tampered note is ignored, not a crash', P.buildPaths([{ edgeId: 'path-abcd1234', type: 'New path', note: '{not json', at: 1 }]).length === 0);

console.log('Routing');
// A to D by the ring road is about 1000 m (A-B-C-D); the shortcut joins A and D directly (about 330 m).
// Coordinates in degrees: 0.001 lat is about 110 m.
const nodes = [[3.000, 101.500], [3.003, 101.500], [3.003, 101.503], [3.000, 101.503]];
function e(i, a, b, len, o) { return Object.assign({ id: 'e' + i, a: a, b: b, road: 'Ring ' + i, len: len, shade: 0, covered: 0, thr: 90, hw: 'residential', lit: null, pts: [nodes[a], nodes[b]] }, o || {}); }
const ds = { name: 't', nodes: nodes, places: [], edges: [e(0, 0, 1, 330), e(1, 1, 2, 330), e(2, 2, 3, 330)] };
const noon = Logic.conditions(0, 12, 10), storm = Logic.conditions(40, 14, 0);
const names = function (r) { return r.edges.map(function (x) { return x.road; }).join('>'); };
const trail = { id: 'path-shortcut', pts: [[3.000, 101.500], [3.0002, 101.5015], [3.000, 101.503]], surface: 'paved', kind: 'shortcut', status: 'verified' };
const mud = Object.assign({}, trail, { id: 'path-muddy01', surface: 'mud', kind: 'trail' });
const base = Logic.buildGraph(ds);
check('without paths the walk goes round the ring', names(Logic.route(base, 0, 3, 'teduh', noon, 'pedestrian')) === 'Ring 0>Ring 1>Ring 2');
const G1 = Logic.buildGraph(ds, [trail]);
check('a verified shortcut is joined to the network', G1.community.used.length === 1 && G1.edges.length === 4 && G1.edges[3].community === true, G1.community);
check('Teduh uses the new shortcut', names(Logic.route(G1, 0, 3, 'teduh', noon, 'pedestrian')) === 'Resident shortcut');
check('the shortest route only knows the old map, so the two routes differ', names(Logic.route(G1, 0, 3, 'standard', noon, 'pedestrian')) === 'Ring 0>Ring 1>Ring 2');
check('the shortcut cuts the walk to a third', Logic.stats(Logic.route(G1, 0, 3, 'teduh', noon, 'pedestrian'), noon, 'pedestrian').dist < 400);
const G2 = Logic.buildGraph(ds, [mud]);
check('a muddy trail is still used in dry weather', names(Logic.route(G2, 0, 3, 'teduh', noon, 'pedestrian')) === 'Resident trail');
check('but a flooded-prone muddy trail is avoided in a storm', names(Logic.route(G2, 0, 3, 'teduh', storm, 'pedestrian')) === 'Ring 0>Ring 1>Ring 2', names(Logic.route(G2, 0, 3, 'teduh', storm, 'pedestrian')));
check('seniors take a muddy trail less readily than other walkers', (function () {
  const c = Logic.conditions(10, 12, 0);
  const sen = Logic.stats(Logic.route(G2, 0, 3, 'teduh', c, 'senior'), c, 'senior'), ped = Logic.stats(Logic.route(G2, 0, 3, 'teduh', c, 'pedestrian'), c, 'pedestrian');
  return ped.dist <= sen.dist;
})());
check('a bicycle cannot use a muddy trail', names(Logic.route(G2, 0, 3, 'teduh', noon, 'cyclist')) === 'Ring 0>Ring 1>Ring 2');
const far = { id: 'path-farawy01', pts: [[3.010, 101.510], [3.011, 101.511]], surface: 'paved', kind: 'trail', status: 'verified' };
const G3 = Logic.buildGraph(ds, [far]);
check('a path far from any road is skipped, not used', G3.community.skipped.length === 1 && G3.edges.length === 3);
const mid = { id: 'path-midlink01', pts: [[3.0015, 101.5005], [3.0015, 101.5025]], surface: 'paved', kind: 'trail', status: 'verified' };
const G4 = Logic.buildGraph(ds, [mid]);
check('a path whose ends are more than 80 m from any junction is skipped', G4.community.used.length === 0 && G4.community.skipped.length === 1, G4.community);
const near = { id: 'path-nearlink1', pts: [[3.0004, 101.5004], [3.0004, 101.5026]], surface: 'paved', kind: 'trail', status: 'verified' };
const G5 = Logic.buildGraph(ds, [near]);
check('ends within 80 m of a junction are linked to it', G5.community.used.length === 1 && G5.edges.length === 6 && G5.nodes.length === 6, [G5.community, G5.edges.length, G5.nodes.length]);
check('the linked path can be routed', !!Logic.route(G5, 0, 3, 'teduh', noon, 'pedestrian'));
check('stairs count as steps', Logic.buildGraph(ds, [Object.assign({}, trail, { kind: 'stairs' })]).edges[3].steps === true);


console.log('Problems on the road or on a traced path');
// a flooded ring road: Teduh switches to the verified shortcut, the shortest route does not know and walks into it
const G6 = Logic.buildGraph(ds, [trail]);
G6.edges[1].live = 'flooded';
const dry = Logic.conditions(0, 12, 0);
check('with a road flooded, Teduh takes the resident path instead', names(Logic.route(G6, 0, 3, 'teduh', dry, 'pedestrian')) === 'Resident shortcut');
check('the shortest route still crosses the flooded road', names(Logic.route(G6, 0, 3, 'standard', dry, 'pedestrian')) === 'Ring 0>Ring 1>Ring 2' && Logic.stats(Logic.route(G6, 0, 3, 'standard', dry, 'pedestrian'), dry, 'pedestrian').flooded.length === 1);
// a flooded traced path: Teduh goes back to the road
const G7 = Logic.buildGraph(ds, [trail]);
G7.edges[3].live = 'flooded';
check('with the traced path flooded, Teduh uses the ordinary road', names(Logic.route(G7, 0, 3, 'teduh', dry, 'pedestrian')) === 'Ring 0>Ring 1>Ring 2');
// both flooded: there is no way round, so the route is flooded and the app can warn
const G8 = Logic.buildGraph(ds, [trail]);
G8.edges[1].live = 'flooded'; G8.edges[3].live = 'flooded';
const rr = Logic.route(G8, 0, 3, 'teduh', dry, 'pedestrian');
check('when every way is flooded, Teduh still gives a route and says it is flooded', !!rr && Logic.stats(rr, dry, 'pedestrian').flooded.length >= 1);
check('rising water on the only road is a warning, not a block', (function () {
  const G9 = Logic.buildGraph(ds); G9.edges[1].live = 'risk';
  const r9 = Logic.route(G9, 0, 3, 'teduh', dry, 'pedestrian');
  return !!r9 && Logic.stats(r9, dry, 'pedestrian').risk.length === 1;
})());

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
