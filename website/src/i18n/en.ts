import type { SiteCopy } from './types';

export const en: SiteCopy = {
  meta: {
    home: {
      title: 'HomeyPaw — Care together. Remember every day.',
      description:
        'HomeyPaw is a private family space for pet memories, care logs, and reminders.',
    },
    privacy: {
      title: 'HomeyPaw Privacy Policy',
      description:
        'How HomeyPaw handles family data, photos, videos, Chat, push notifications, and Family Plus subscriptions.',
    },
    terms: {
      title: 'HomeyPaw Terms of Service',
      description:
        'Terms for HomeyPaw family sharing, media storage, Family Plus renewal, cancellation, and restoring purchases.',
    },
    support: {
      title: 'HomeyPaw Support',
      description:
        'Contact HomeyPaw for help with sign-in, family sharing, photos, reminders, or account deletion.',
    },
  },
  nav: {
    home: 'Home',
    privacy: 'Privacy',
    terms: 'Terms',
    support: 'Support',
  },
  languageButton: '繁體中文',
  home: {
    eyebrow: 'A private space for pets and family',
    title: 'Care together. Remember every day.',
    intro:
      'HomeyPaw is a private family space for sharing pet journals, photos, care logs, and reminders — keeping ordinary days close for years to come.',
    primaryAction: 'Read our privacy policy',
    secondaryAction: 'Contact us',
    status: 'iOS version in preparation',
    cardDate: 'Today · At home',
    cardTitle: 'Care lives in the little things.',
    cardBody:
      'A photo, a meal, a walk — small moments worth remembering together.',
    featureEyebrow: 'Care together, keep it together',
    featureTitle: 'The things that matter in everyday pet life',
    features: [
      {
        title: 'Family sharing',
        body: 'Keep one pet’s story with the family members you trust.',
      },
      {
        title: 'Growing memories',
        body: 'Save journals, photos, and memories from this day in past years.',
      },
      {
        title: 'Daily care',
        body: 'Record meals, walks, grooming, and medication together.',
      },
      {
        title: 'Family reminders',
        body: 'See the care your pet needs next.',
      },
    ],
    legalEyebrow: 'Clear and considered',
    legalTitle: 'Your family content stays with the people you authorize.',
    legalBody:
      'HomeyPaw uses authenticated access, data access rules, and private photo storage to protect family content. You can review our policies, contact us, or delete your account in the app.',
  },
  privacy: {
    eyebrow: 'Privacy and data',
    title: 'Privacy Policy',
    intro:
      'This policy explains how HomeyPaw handles private family pet records, media, care coordination, notifications, and Family Plus subscriptions. Subscription processing applies when purchasing is available and you use those features.',
    sections: [
      {
        title: '1. Information we handle',
        paragraphs: [
          'We process content you provide and service data needed for sign-in, family collaboration, media storage, and subscriptions.',
        ],
        bullets: [
          'Account and Profile: email, account identifier, display name, avatar, language preference, authentication and sign-in session data.',
          'Family and pets: Family, membership, Owner/Member/Viewer roles, invites, and pet names, species, breeds, gender, birthdays, adoption dates, and avatars.',
          'Journals and media: text, photos, videos, video thumbnails, tags, dates, manually entered location names, and necessary file-size, upload, and cleanup information.',
          'Care and health: pet care and health records, notes, tasks, reminders, schedules, completions, actual completion times, and associated time zones. These concern pets, not human HealthKit or medical data.',
          'Family interaction: private Chat text, sender and edit/deletion state, Chat read positions, and first-view receipts for journals.',
          'Notification devices: account-linked app installation identifiers, push tokens, platform, app version, and Chat push capability.',
          'Subscriptions: account and Family associations, products and store, purchase and original transaction identifiers, RevenueCat subscription identifiers, purchase/renewal/cancellation/expiry/refund status, access dates, and verification and recovery records.',
          'Support: the email and issue description you choose to send us. Do not send passwords, verification codes, or complete payment details.',
        ],
      },
      {
        title: '2. Purposes and necessary subscription analytics',
        paragraphs: [
          'We use data for authentication, family permissions, content and media delivery, care coordination, notifications, storage metering, support, and security. Purchase data also verifies family membership benefits, restores purchases, prevents duplicate claims, and processes renewals, refunds, and expiry.',
          'RevenueCat Customer History, subscription reports, and charts use purchase records for necessary subscription analytics, such as understanding purchases, renewals, expiry, and revenue. Purchase history can be linked to your HomeyPaw account through a stable account identifier. This is separate from general journal-browsing analytics.',
          'We do not sell personal data, use private family content for advertising, use advertising identifiers, or combine data with other companies’ apps or websites for advertising tracking.',
        ],
      },
      {
        title: '3. Family sharing and access',
        paragraphs: [
          'One HomeyPaw Family can contain multiple pets. The Owner manages the Family, members, and invites; Members and Viewers receive role-based access. Journals, media, and care data are available only to currently authorized family members. Private Chat is limited to active Owners and Members and does not change when switching pets.',
          'Members can see the Family plan and storage usage. Sharing Family Plus does not give members access to the payer’s Apple sign-in or bank details. Private invite codes are stored as hashes and are subject to expiry and joining rules.',
          'Removing a member revokes future access, but cannot recall copies someone has already downloaded, exported, or saved elsewhere. Device caches and previously issued links may also take time to expire. Invite only people you trust.',
        ],
      },
      {
        title: '4. Photos, videos, and device permissions',
        paragraphs: [
          'The app requests the relevant photo-library, camera, or save permission when you choose a photo or video, take a photo, or select Save to Photos. Selected media may be processed in the app before uploading to private Supabase Storage and displayed through permission-protected, time-limited links.',
          'Selected videos may retain their existing sound. The app does not offer video or audio recording or request microphone-recording permission. We do not access contacts or GPS location; journal locations are text you enter manually.',
        ],
      },
      {
        title: '5. Local reminders and remote push',
        paragraphs: [
          'Care reminders you enable can be scheduled locally on your device. Remote family-activity and Chat notifications use account-linked installation identifiers and push tokens, delivered through Expo Push Service and platform notification services, including Apple Push Notification service on iOS.',
          'Push notifications may contain notification text and identifiers that route to relevant content. Chat notifications may include the sender’s display name but not the message body. Recipients are checked against current family access and device capability. You can decline or change notification permission in system settings; core record-keeping does not require accepting push notifications.',
        ],
      },
      {
        title: '6. Read and unread state',
        paragraphs: [
          'When you intentionally open another member’s Journal Post Detail, photo viewer, or video viewer, HomeyPaw records the Post, your account, and first-view time for authorized family members. Passive Feed visibility, thumbnails, preloading, and swiping between photos within the same Post do not add receipts. Reopening preserves the first-view time, and authors are not recorded as their own readers.',
          'Chat stores read positions for unread state. These interactions support app functionality, not dwell-time or per-media browsing analytics, and journal read receipts do not generate notifications.',
        ],
      },
      {
        title: '7. Apple payments and RevenueCat',
        paragraphs: [
          'Apple App Store processes Family Plus in-app purchases and payments. HomeyPaw does not directly collect card numbers, bank accounts, or payment-authentication details.',
          'RevenueCat receives your stable HomeyPaw account UUID and Apple transaction, product, and subscription information for verification. Its SDK also processes technical details needed for the service, such as app/platform versions, locale, and currency. HomeyPaw’s backend synchronizes Family access from trusted store information; a client’s claim of a successful purchase does not itself grant access.',
          'RevenueCat does not need your private journals, photos, videos, or Chat content to verify subscriptions. Membership benefits, payer identity, and Family ownership are handled separately. Deleting a HomeyPaw account or Family does not cancel an Apple subscription.',
        ],
      },
      {
        title: '8. Providers, storage, and the website',
        paragraphs: [
          'Supabase provides authentication, database services, private file storage, Realtime, and server functions. Apple, RevenueCat, and Expo process information needed for the payment, verification, and notification purposes described above. Providers may process data on infrastructure outside your location and their services are also subject to their own privacy policies and terms.',
          'Vercel hosts the public website. Website requests generate technical information needed to deliver pages and maintain security, such as IP addresses, browser information, and access logs. The site stores only your selected language in localStorage; visiting legal pages does not access your private family content in the app.',
        ],
      },
      {
        title: '9. Retention, deletion, and subscription records',
        paragraphs: [
          'You can request permanent account deletion in Me → Account and security. A Family Owner must first transfer ownership or delete the Family. Account deletion removes the sign-in account, personal Profile, membership, and associated push-device records. Shared family history may remain with the author/sender account link removed.',
          'Deleting a Post deletes its read receipts. Deleting a reader account removes its receipt account link, and removed or deleted accounts no longer appear in the visible reader list. Family deletion removes Family and pet-related business data through the confirmation workflow and schedules media cleanup.',
          'Physical media files may be handled through cleanup queues. Technical backups, security records, and necessary support information may remain for a period under provider or operational processes; deletion from every copy cannot be immediate. Save content you need before deleting it. We do not promise permanent retention.',
          'Subscription and transaction records needed to maintain valid Family access, prevent duplicate claims, handle refunds, or investigate disputes may remain. Deleting the payer’s account removes its account link and does not automatically transfer transactions to another Family. Storage overage or membership expiry alone does not automatically delete historical media.',
        ],
      },
      {
        title: '10. Security and your choices',
        paragraphs: [
          'We use HTTPS, authentication, row-level permissions, restricted server interfaces, and private file-access rules to reduce unauthorized access. No online service can guarantee absolute security. Protect your sign-in details and family invite codes.',
          'You can view, update, or delete content through available app features, adjust device permissions, or contact the email below to request access, correction, or deletion. We handle requests under applicable law and reasonable identity-verification procedures.',
        ],
      },
      {
        title: '11. Children',
        paragraphs: [
          'HomeyPaw is a family pet record tool and is not directed primarily at children. A parent or guardian who believes a child provided personal data without appropriate consent should contact us.',
        ],
      },
      {
        title: '12. Updates and contact',
        paragraphs: [
          'We update this page and its date when features or data handling change materially. Updating this page does not itself enable subscriptions or new storage restrictions.',
          'For privacy, data, or deletion questions, email lenny996@163.com.',
        ],
      },
    ],
    lastUpdated: 'Last updated: October 26, 2026',
  },
  terms: {
    eyebrow: 'Using HomeyPaw',
    title: 'Terms of Service',
    intro:
      'These terms apply to HomeyPaw’s private family pet space and Family Plus. Purchase availability, Family benefits, and storage policies depend on what the app displays and the backend confirms.',
    sections: [
      {
        title: '1. Eligibility and accounts',
        paragraphs: [
          'By using HomeyPaw, you agree to use its private family records and care-coordination service lawfully and confirm you can agree to these terms. Provide accurate information, protect sign-in credentials, and change your password and contact us promptly if you discover unauthorized activity.',
        ],
      },
      {
        title: '2. Families, roles, and sharing',
        paragraphs: [
          'A HomeyPaw Family can contain multiple pets. The Owner manages the Family, pets, invites, and members. Members and Viewers access content under the role rules shown in the app and enforced by the backend. Private Chat is limited to active Owners and Members. Removed members lose future access.',
          'Family Plus belongs to the Family, not to an individual member or pet. One Family Owner pays and that Family’s active members share verified benefits. Only an Owner who meets backend eligibility can initiate in-app purchase or restore operations. Members and Viewers view shared benefits, without purchasing again for the Family or restoring someone else’s subscription. HomeyPaw family sharing is not Apple Family Sharing; membership in an Apple family group does not automatically grant HomeyPaw Family access.',
        ],
      },
      {
        title: '3. Content and acceptable use',
        paragraphs: [
          'You retain rights to text, photos, videos, and other content you upload and must have permission to use and share it. You allow HomeyPaw to store, process, copy, and display it to authorized family members as needed to provide the service. Uploading does not transfer ownership to us.',
          'Do not upload unlawful, infringing, fraudulent, threatening, or abusive content; access other people’s data without permission; bypass security, storage, or payment restrictions; distribute malware; or consume upload and storage resources unreasonably.',
        ],
      },
      {
        title: '4. Free and Family Plus storage',
        paragraphs: [
          'The 1.4.0 family media plans are Free: 300 MiB per Family; Family Plus: 5 GiB shared per Family. Basic family records and care features remain free. The new storage policy applies only after formal activation and notice to users. Updating this page does not itself enable quota enforcement or start a transition period.',
          'The backend meters family media, including journal photos, videos, and thumbnails. Media awaiting cleanup and unreleased upload reservations can temporarily occupy space. Deleting content in the interface may not immediately release physical storage. Unconfirmed usage does not mean zero usage.',
          'Videos on both plans remain subject to individual file-size, duration, format, and total Family storage limits. Family Plus does not promise unlimited videos, uploads, or individual file sizes.',
        ],
      },
      {
        title: '5. Prices and automatic renewal',
        paragraphs: [
          'Current Hong Kong prices are HK$32 per month or HK$228 per year. The monthly plan is billed monthly. The yearly plan is charged once per year, not in monthly instalments. Prices, currency, taxes, and the final charge in any storefront are those shown at Apple checkout.',
          'Apple charges your Apple Account when you confirm a purchase. Subscriptions renew automatically until cancelled; Apple may charge within 24 hours before the next period begins. Cancel through Apple Subscriptions before renewal, preferably allowing at least 24 hours, and follow the renewal and expiry times Apple displays. Price changes follow Apple’s notices, consent requirements, and applicable rules.',
          'We do not promise a free trial or offer that Apple does not explicitly present. A purchase confirmation sheet alone does not verify Family benefits: use the backend-confirmed membership status in the app, and do not purchase again while verification is pending.',
        ],
      },
      {
        title: '6. Management, cancellation, and refunds',
        paragraphs: [
          'Use Manage Apple Subscription in the app, or iPhone Settings → your Apple Account → Subscriptions, to manage or cancel. Cancelling automatic renewal normally does not immediately end paid, valid access or automatically refund previous charges.',
          'Request refunds through Apple’s Report a Problem service at reportaproblem.apple.com. Eligibility and refunds are governed by Apple and applicable law. Refunds, revocations, or confirmed invalidation can end Family Plus benefits. These terms do not limit statutory consumer rights.',
        ],
      },
      {
        title: '7. Restore purchases and payer identity',
        paragraphs: [
          'The original payer should use the original HomeyPaw account, corresponding Family, and the same Apple purchasing account, meet current Owner eligibility, then choose Family plan → Restore purchases to verify an existing purchase. Restoring does not place a new order or make an expired or revoked subscription valid again. Contact support if changed Family ownership or payer identity prevents restoration; the original payer can still manage their subscription directly through Apple.',
          'Changing HomeyPaw sign-in does not change the Apple purchasing account. Ownership is verified from trusted Apple/RevenueCat transactions and backend Family bindings; switching accounts, pets, or Families does not automatically transfer it. If an Apple purchase identity is already bound to another HomeyPaw account, use the original payer account or contact support rather than purchasing repeatedly to attempt a transfer.',
          'Transferring Family ownership, leaving a Family, or creating another Family does not transfer the original payer’s Apple subscription or grant the same transaction to a different Family.',
        ],
      },
      {
        title: '8. Billing grace and membership expiry',
        paragraphs: [
          'Cancelling renewal differs from immediate expiry. If payment fails, Family Plus continues only while Apple/RevenueCat verifies grace access and the backend confirms its deadline. Billing retry alone does not guarantee extra access, and the app does not independently extend a fixed grace period.',
          'After actual expiry without valid grace, a refund, or revocation, the Family returns to Free as confirmed by the backend. Once the storage policy is active, usage above the currently available allowance pauses new media uploads. Historical media is not automatically deleted merely because of downgrade or overage; authorized members can still view, download, and actively clean it up.',
        ],
      },
      {
        title:
          '9. Fifteen-day transition for existing over-limit Free Families',
        paragraphs: [
          'This mechanism starts only when Production first formally activates the new storage policy; updating this page does not start it. Families that already exist at activation, are Free, and have backend-confirmed usage above 300 MiB qualify for a one-time 15-day transition, meaning 360 consecutive hours from the common server-recorded activation time. New Families do not automatically qualify.',
          'A temporary 1 GiB Family allowance applies during transition, not unlimited uploading. A Family already above 1 GiB must clean up or upgrade before adding media. At the deadline, Free Families use the 300 MiB allowance and overage pauses new uploads without automatically deleting historical content.',
          'Eligibility and the deadline are confirmed by the backend and cannot restart through sign-in, pet switching, or member actions. Valid Family Plus access takes priority at 5 GiB and is not revoked because an old transition ends. This mechanism is separate from Apple subscription billing grace.',
        ],
      },
      {
        title: '10. Account, Family, and content deletion',
        paragraphs: [
          'You can permanently delete your account in Me → Account and security. Owners must first transfer Family ownership or delete the Family. Shared family history may remain with personal account links removed. Family deletion removes its pets and related Family business records; physical media may be processed through cleanup queues. See this site’s Privacy Policy for details.',
          'Deleting the app, HomeyPaw account, Family, or pet does not automatically cancel an Apple subscription or issue a refund. The original payer should manage it through Apple Subscriptions first. Deletion does not attach the subscription to a new Family. Necessary transaction and verification records may remain under the Privacy Policy. Deletion cannot be undone; save content you need beforehand.',
        ],
      },
      {
        title: '11. Health, reminders, and availability',
        paragraphs: [
          'HomeyPaw is not a veterinary, medical, or emergency service. Records, schedules, and notifications are coordination tools affected by permissions, networks, devices, time zones, providers, and technical limits. Follow professional advice and use backup reminders for important care or medication.',
          'We work to maintain the service but do not promise uninterrupted availability, immediate synchronization, or permanent retention. Maintenance, security, or technical issues may temporarily limit features. Keep personal copies of important content.',
        ],
      },
      {
        title: '12. Liability and applicable rights',
        paragraphs: [
          'To the extent permitted by applicable law, the service is provided as is and is not guaranteed to be error-free. HomeyPaw is not responsible for losses from treating it as veterinary, medical, emergency, or your only reminder service. Rights and responsibilities that law does not allow to be excluded or limited remain unaffected.',
          'Downloads and purchases through Apple are also subject to its store terms and applicable app licence terms. These service terms do not replace Apple’s payment, renewal, or refund rules.',
        ],
      },
      {
        title: '13. Updates and contact',
        paragraphs: [
          'We update this page’s date when the service materially changes. Activation arrangements for new charges or storage policies will be communicated through the app when applicable; terms text does not itself open purchases or apply restrictions.',
          'For terms, subscription, or family-data questions, email lenny996@163.com.',
        ],
      },
    ],
    lastUpdated: 'Last updated: October 26, 2026',
  },
  support: {
    eyebrow: 'We are here to help',
    title: 'Contact HomeyPaw',
    intro:
      'If you run into a problem with HomeyPaw, tell us what happened, your device version, and any message you saw. Do not email passwords, sign-in links, or authentication tokens.',
    issuesTitle: 'We can help with',
    issues: [
      'Sign-in and passwords',
      'Family sharing and invites',
      'Photo selection and display',
      'Care reminders',
      'Account deletion',
    ],
    emailLabel: 'Support email',
    emailAction: 'Send an email',
    response: 'We’ll get back to you as soon as we can.',
    detailsTitle: 'App details',
    details: [
      { label: 'App', value: 'HomeyPaw' },
      { label: 'Platform', value: 'iOS' },
      { label: 'Version', value: '1.0' },
    ],
  },
  footer: {
    tagline: 'A private space for pets and family.',
    copyright: '© 2026 HomeyPaw',
  },
};
