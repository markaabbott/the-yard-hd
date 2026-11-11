import LegalPage, { H, P, L, CONTACT } from '../components/LegalPage';

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" effective="November 2026">
      <P>
        This policy explains what The Yard HD LLC (&ldquo;The Yard HD,&rdquo; &ldquo;The Yard,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;) collects when you use
        app.theyardhd.com, theyardhd.com, or visit our facility in Apple Valley, California, and what we do with it.
        The short version: we collect what we need to run your bookings, we don&rsquo;t sell it, and you can ask us to see or delete it.
      </P>

      <H>What we collect</H>
      <L items={[
        <><strong>Account details:</strong> your name, email address, and phone number. If you sign in with Google or Apple, we receive your name, email address, and profile picture from that service. We never receive your Google or Apple password.</>,
        <><strong>Bookings:</strong> the cages, dates, and times you reserve; team, party, and guest names you enter; membership hours; cancellations and no-shows.</>,
        <><strong>Payments:</strong> card payments are processed by Stripe. Your full card number goes directly to Stripe and is never stored on our systems. We keep a record of amounts, dates, refunds, and the payment&rsquo;s status.</>,
        <><strong>Staff notes:</strong> our staff may keep short notes on your profile to help serve you (for example, a preferred cage). These are visible only to our staff.</>,
        <><strong>Waivers:</strong> the liability waiver signed for each participant, including a parent or guardian&rsquo;s signature for minors.</>,
        <><strong>Technical data:</strong> your browser keeps a sign-in session so you stay logged in, and our hosting providers record standard server logs (such as IP address and browser type) for security and troubleshooting. We do not use advertising trackers.</>,
        <><strong>Video:</strong> the facility, exterior, and parking area are under video surveillance for safety and security.</>,
      ]} />

      <H>How we use it</H>
      <L items={[
        'To create and manage your account and bookings, take payment, and issue refunds.',
        'To send you booking confirmations, receipts, reminders, changes, and cancellation notices by email.',
        'To run the facility: staff schedules, check-ins, memberships, and enforcing our Facility Policies.',
        'To keep the facility and our systems safe, and to investigate damage, injuries, or misuse.',
        'To meet legal, tax, and accounting obligations.',
      ]} />
      <P>We do not send marketing email unless you ask for it, and you can unsubscribe at any time.</P>

      <H>Who we share it with</H>
      <P>We do not sell or rent your personal information. We share it only with the companies that run parts of our service for us, and only for that purpose:</P>
      <L items={[
        <><strong>Supabase</strong> (database and sign-in)</>,
        <><strong>Stripe</strong> (card payments and refunds)</>,
        <><strong>Vercel</strong> (website hosting)</>,
        <><strong>Resend</strong> (sending our emails)</>,
        <><strong>Google and Apple</strong>, only if you choose to sign in with them</>,
      ]} />
      <P>We may also disclose information if required by law, to respond to a valid legal request, or to protect the safety of our players, staff, or property.</P>

      <H>Children</H>
      <P>
        Many of our players are minors, but accounts are for adults. Bookings for players under 18 should be made by a parent,
        guardian, or coach. We do not knowingly create accounts for children under 13 or collect their personal information
        directly. If you believe a child under 13 has given us personal information, contact us and we will delete it.
      </P>

      <H>How long we keep it</H>
      <P>
        We keep account and booking records while your account is open and for as long as needed for accounting, tax, and
        legal purposes. Surveillance video is kept for a limited time and then overwritten, unless it is needed for an incident.
      </P>

      <H>Your choices and rights</H>
      <P>
        You can update your name and phone number in your account, or ask us to do it. You can ask us for a copy of your
        information, to correct it, or to delete your account by emailing <a href="mailto:info@theyardhd.com">info@theyardhd.com</a>.
        We will respond within 30 days. We may keep records we are legally required to retain, such as payment records.
      </P>
      <P>
        If you live in California, you have the right to know what personal information we collect, to request deletion, to
        correct it, and not to be treated differently for exercising these rights. We do not sell or share personal information
        for cross-context behavioral advertising.
      </P>

      <H>Do Not Track</H>
      <P>
        Our site does not track you across other websites, and we do not allow third parties to do so. Because we don&rsquo;t
        do that kind of tracking, we don&rsquo;t change anything when your browser sends a &ldquo;Do Not Track&rdquo; signal.
      </P>

      <H>Security</H>
      <P>
        Your information is stored with providers that encrypt it in transit and at rest, and access is limited to the staff
        who need it. No system is perfectly secure, but we take reasonable steps to protect your information and will notify
        you if a breach affects it, as the law requires.
      </P>

      <H>Changes</H>
      <P>If we change this policy, we will post the new version here with a new effective date. For significant changes, we will also let account holders know by email.</P>

      <H>Contact us</H>
      <P>{CONTACT}</P>
    </LegalPage>
  );
}
