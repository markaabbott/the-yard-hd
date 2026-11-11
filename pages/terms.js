import LegalPage, { H, P, L, CONTACT } from '../components/LegalPage';

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" effective="November 2026">
      <P>
        These terms apply when you create an account, book, or pay through app.theyardhd.com or theyardhd.com, and when you use
        The Yard HD facility. The site and facility are operated by The Yard HD LLC (&ldquo;The Yard HD,&rdquo; &ldquo;The Yard,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating an account or making a booking,
        you agree to these terms, to our Facility Policies posted at the facility, and to our <a href="/privacy">Privacy Policy</a>.
      </P>

      <H>Your account</H>
      <L items={[
        'You must be at least 18 to create an account. Parents, guardians, and coaches book on behalf of minor players.',
        'Give us accurate contact information and keep it current, so booking emails and receipts reach you.',
        'You are responsible for activity on your account. Tell us right away if you think someone else has used it.',
        'We may suspend or close an account for violations of these terms or our Facility Policies, unpaid balances, or misuse of the site.',
      ]} />

      <H>Bookings and payment</H>
      <L items={[
        'Prices are shown before you confirm a booking and are charged in U.S. dollars. Card payments are processed by Stripe.',
        'A booking is confirmed when you receive a confirmation email. A slot held during checkout is released if payment is not completed.',
        'Some bookings are paid at the facility or require a deposit, as shown when you book. Unpaid balances may block future bookings.',
        'Reservations are for the person or team that booked them and may not be transferred or resold.',
        'Your reserved time includes setup and cleanup. Arriving late does not extend it.',
      ]} />

      <H>Cancellations and refunds</H>
      <P>
        Cancellations, refunds, no-shows, memberships, team practice cycles, and party deposits are governed by our Facility
        Policies in effect when you book. In summary: cancellations are free until 48 hours before your start time; between 48
        and 24 hours, half the amount paid is refunded; inside 24 hours and no-shows are non-refundable. Refunds for cancellations
        you request are returned less the card processing fee. If The Yard cancels, you receive a full refund, credit, or
        reschedule.
      </P>

      <H>Memberships</H>
      <P>
        Membership hours are good for 31 days from purchase and expire at the end of that term. Unused hours do not carry over
        and have no cash value. Hours spent on a booking you cancel late are forfeited.
      </P>

      <H>Facility rules and safety</H>
      <L items={[
        'Everyone at the facility must follow our Facility Policies and staff instructions, including helmet, footwear, and supervision rules.',
        'A signed liability waiver is required for every participant before they use the facility. A parent or guardian signs for minors.',
        'Players under 16 must have a parent, guardian, or team coach inside the building for the entire reservation.',
        'We may remove anyone who breaks the rules or puts others at risk, without a refund.',
      ]} />

      <H>Assumption of risk</H>
      <P>
        Baseball and softball training involves inherent risks, including being struck by balls or bats, and can result in
        injury. You participate, and allow the players in your group to participate, at your own risk, as described in the
        signed liability waiver.
      </P>

      <H>Damage and personal property</H>
      <P>
        The account holder who made a booking is responsible for damage to the facility or equipment caused by anyone in their
        group, and we may charge the card on file or bill you for repairs. We are not responsible for lost, stolen, or damaged
        personal equipment.
      </P>

      <H>Using the website</H>
      <L items={[
        'Do not interfere with the site, try to access accounts or data that are not yours, or use automated tools to book or scrape it.',
        'The site, our name, and our logo belong to The Yard HD LLC. You may not use them without permission.',
        'We may change, pause, or discontinue features of the site at any time.',
      ]} />

      <H>Disclaimers and limitation of liability</H>
      <P>
        The website is provided &ldquo;as is.&rdquo; We work to keep it accurate and available but do not guarantee it will be
        error-free or uninterrupted. To the fullest extent allowed by law, The Yard HD is not liable for indirect, incidental, or
        consequential damages, and our total liability for any claim related to the website or a booking is limited to the
        amount you paid for the booking involved. Nothing in these terms limits liability that cannot be limited under
        California law.
      </P>

      <H>Governing law</H>
      <P>
        These terms are governed by the laws of the State of California. Any dispute will be handled in the state or federal
        courts located in San Bernardino County, California, unless the law requires otherwise.
      </P>

      <H>Changes to these terms</H>
      <P>
        We may update these terms. The new version will be posted here with a new effective date, and it applies to bookings
        made after that date.
      </P>

      <H>Contact us</H>
      <P>{CONTACT}</P>
    </LegalPage>
  );
}
