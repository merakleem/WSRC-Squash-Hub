// Mirrors the prototype's sample data, shaped as the API returns it.
const A = (names) => names.map((n) => ({ name: n, initials: n.split(' ').map(w=>w[0]).join('').toUpperCase() }));
const NAMES = ['Sofia Duarte','Iain Chalmers','Nadia Farouk','Ben Halvorsen','Grace Odell','Peter Lindqvist','Yusuf Demir','Clara Nowak','Daniel Okafor','Tom Ashcroft','Priya Raman','Kate Sorensen','Hugo Bellamy','Ana Ruiz','Owen Blythe','Lena Vogt'];
const att = (n, guests=[]) => NAMES.slice(0, n).map((nm, i) => ({ player_id: 100+i, name: nm, initials: nm.split(' ').map(w=>w[0]).join('').toUpperCase(), member_number: 'M-'+(1100+i), guests: guests[i]||0 }));
export const EVENTS = {
  upcoming: [
    { id:1, name:'Back to the Bunker', description:'Social night in the old bunker bar. Round-robin on courts 1–3 from 7, food and drinks after.', event_date:'2026-09-18', start_time:'19:00', guests_allowed:2, max_people:40, members_count:22, guests_count:5, total:27, spots_left:13, full:false, my_signup:null, link:null, preview:A(['Sofia Duarte','Iain Chalmers','Nadia Farouk']) },
    { id:2, name:'Club Championships 2026', description:'Annual knockout. Draw published the Thursday before; matches best of five.', event_date:'2026-10-03', start_time:'09:00', guests_allowed:0, max_people:32, members_count:32, guests_count:0, total:32, spots_left:0, full:true, my_signup:null, link:{type:'tournament', id:9, name:'Club Championships 2026'}, preview:A(['Ben Halvorsen','Grace Odell','Peter Lindqvist']) },
    { id:3, name:'Doubles Night', description:'Casual doubles, partners drawn on the night. All levels welcome.', event_date:'2026-10-15', start_time:'18:30', guests_allowed:1, max_people:null, members_count:15, guests_count:4, total:19, spots_left:null, full:false, my_signup:{guests:1}, link:null, preview:A(['Yusuf Demir','Clara Nowak','Daniel Okafor']) },
    { id:5, name:'Winter League 2027 registration', description:'Sign up here to play in the Winter League.', event_date:'2026-12-01', start_time:null, guests_allowed:0, max_people:null, members_count:9, guests_count:0, total:9, spots_left:null, full:false, my_signup:null, link:{type:'league', id:4, name:'Winter League 2027'}, preview:A(['Tom Ashcroft','Priya Raman','Kate Sorensen']) },
  ],
  past: [
    { id:7, name:'Season Opener BBQ', description:'Kick-off for the autumn season.', event_date:'2026-08-28', start_time:'18:00', guests_allowed:2, max_people:null, members_count:32, guests_count:12, total:44, spots_left:null, full:false, my_signup:{guests:0}, link:null, preview:A(['Hugo Bellamy','Ana Ruiz','Owen Blythe']) },
    { id:8, name:'Summer Handicap', description:'', event_date:'2026-06-20', start_time:'10:00', guests_allowed:0, max_people:24, members_count:24, guests_count:0, total:24, spots_left:0, full:true, my_signup:null, link:{type:'tournament', id:2, name:'Summer Handicap'}, preview:A(['Lena Vogt','Sofia Duarte','Ben Halvorsen']) },
  ],
};
export const DETAILS = {};
for (const list of Object.values(EVENTS)) for (const e of list) DETAILS[e.id] = { ...e, attendees: att(Math.min(e.members_count, 16), e.id===1?[2,1,1,1]:[1,1,1,1]) };
// The signed-up viewer appears in their events' attendee lists.
DETAILS[3].attendees = [{ player_id: 42, name:'Merak Lee', initials:'ML', member_number:'M-1042', guests:1 }, ...DETAILS[3].attendees.slice(0,14)];
DETAILS[7].attendees = [{ player_id: 42, name:'Merak Lee', initials:'ML', member_number:'M-1042', guests:0 }, ...DETAILS[7].attendees.slice(0,15)];
