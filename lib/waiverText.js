// The liability waiver customers sign, exactly as approved (Nov 2026).
// Changing ANY wording: bump WAIVER_VERSION here AND run
//   update facility_settings set waiver_version = '<new version>' where id = 1;
// Everyone is then asked to sign the new version before their next booking.

export const WAIVER_VERSION = '2026-11-v1';
export const WAIVER_TITLE = 'Release of Liability, Assumption of Risk, and Indemnity Agreement';
export const WAIVER_YEARS = 1;

export const WAIVER_INTRO = [
  'The Yard HD LLC · 18737 Highway 18, Ste 11, Apple Valley, CA 92307 · (760) 553-5996',
  'Please read this carefully. By signing, you give up certain legal rights, including the right to sue.',
  'In this agreement, "The Yard" means The Yard HD LLC and its owners, members, managers, employees, coaches, contractors, volunteers, and landlord. The "Participant" is each person named below who uses the facility. "I" and "me" mean the person signing: an adult Participant, or the parent or legal guardian of a minor Participant.',
  'This agreement covers every visit, reservation, clinic, team practice, and party at The Yard. It stays in effect for one year from the date signed.',
];

export const WAIVER_SECTIONS = [
  {
    title: '1. Risks of batting cages, training, and physical activities',
    paras: [
      'I understand that the activities at The Yard carry a risk of injury. These include baseball and softball training with batting cages, pitching machines, and live pitching; agility, speed, strength, and conditioning training; and physical education classes, clinics, camps, and other physical activities. The risks include, but are not limited to:',
    ],
    bullets: [
      'Being struck by a pitched, batted, thrown, or ricocheting ball',
      'Being struck by a swung bat, or by equipment, nets, frames, or screens',
      'Malfunction or unexpected operation of a pitching machine',
      'Injuries from running, jumping, cutting, sprinting, lifting, and agility drills, including use of ladders, cones, hurdles, sleds, bands, weights, and other training equipment',
      'Collisions with other participants, walls, nets, or equipment during drills, games, and group activities',
      'Slips, trips, and falls on turf, mats, stairs, or the mezzanine',
      'Muscle strains, sprains, fractures, concussions, eye and dental injuries',
      'Heat illness, dehydration, overexertion, and cardiac or other medical events during exercise',
      'The actions of other players, coaches, instructors, and guests',
    ],
    after: 'Some of these injuries can be serious, permanent, or fatal. I understand these risks, and I voluntarily assume all of them, both known and unknown, for the Participant.',
  },
  {
    title: '2. Release and waiver',
    paras: [
      'In exchange for being allowed to use The Yard, I release, waive, and agree not to sue The Yard for any injury, illness, death, or loss of or damage to property that happens to the Participant at The Yard or because of its activities, including injury caused by the ordinary negligence of The Yard.',
      'This release does not cover gross negligence or intentional misconduct.',
    ],
  },
  {
    title: '3. Indemnity',
    paras: [
      "I agree to defend and repay The Yard for any claim, cost, or attorney's fees brought by anyone because of the Participant's actions at The Yard, or brought on the Participant's behalf in violation of this agreement.",
    ],
  },
  {
    title: '4. Property',
    paras: [
      'The Yard is not responsible for lost, stolen, or damaged personal equipment or belongings. I am responsible for any damage the Participant or my guests cause to the facility or its equipment.',
    ],
  },
  {
    title: '5. Minor participants',
    paras: [
      "If a Participant is under 18, I confirm that I am that child's parent or legal guardian and have the authority to sign for them. I agree to this entire agreement on the child's behalf and on my own.",
      'I understand that every player under 16 must have a parent, guardian, or team coach physically inside the building for the entire reservation. Staff do not provide supervision or childcare.',
    ],
  },
  {
    title: '6. Health and medical care',
    paras: [
      'I confirm the Participant is in good health and able to take part safely. I will tell staff about any condition that affects that.',
      'If the Participant is injured or ill and I cannot be reached, I authorize The Yard to call emergency services and to arrange first aid or emergency medical treatment. I am responsible for any resulting medical costs. The Yard does not provide medical insurance for Participants.',
    ],
  },
  {
    title: '7. Rules, photos, and general terms',
    bullets: [
      "Facility rules. The Participant will follow The Yard's Facility Policies and staff instructions, including helmets for every batter, one batter per cage, and no cleats. The Yard may remove anyone who does not, without a refund.",
      'Photos and video. The facility is recorded by video. The Yard may use photos or video taken at the facility for promotion. To opt out, I will tell The Yard in writing.',
      'Governing law. This agreement is governed by California law. It is intended to be as broad as California law allows. If any part is found unenforceable, the rest stays in effect.',
      'Entire agreement. I have read this agreement, I understand it, and I sign it voluntarily. No one has made any promise to me that is not written here.',
    ],
  },
];

export const AGREE_READ = 'I have read this agreement and agree to it for myself and every participant listed.';
export const AGREE_SUE = 'I understand that by signing, I am giving up the right to sue The Yard.';
