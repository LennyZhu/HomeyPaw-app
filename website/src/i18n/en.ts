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
        'Learn how HomeyPaw handles account, pet, family, journal, photo, and care data.',
    },
    terms: {
      title: 'HomeyPaw Terms of Service',
      description:
        'Plain-language terms for using HomeyPaw as a private family pet space.',
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
      'This policy explains the information HomeyPaw handles to provide a private family pet journal, care log, and reminder service.',
    sections: [
      {
        title: '1. Information we handle',
        paragraphs: [
          'HomeyPaw handles information you choose to provide when you create an account, use a feature, or share with family members.',
        ],
        bullets: [
          'Account and Profile: email address, display name, and language preference.',
          'Pet data: name, species, breed, gender, birthday, adoption date, and avatar.',
          'Family sharing: pet membership, Owner or Member role, and private invite data.',
          'Journal: text, photos, tags, dates, and a location name only when you enter it manually.',
          'Care logs: care type, time, notes, and the person who recorded the care.',
          'Care tasks and reminders: task title, schedule, recurrence, and completion data.',
        ],
      },
      {
        title: '2. How we use information',
        paragraphs: [
          'We use this information to authenticate accounts; show pet and family content; store journals and photos; coordinate care logs; schedule local reminders you enable; respond to support requests; and keep the service secure and functioning.',
          'HomeyPaw does not use private family content for advertising or cross-app tracking, and does not sell personal information.',
        ],
      },
      {
        title: '3. Supabase and data storage',
        paragraphs: [
          'HomeyPaw uses Supabase for authentication, database services, private file storage, and selected server functions. Account and app content is stored on Supabase infrastructure and is not kept only on your device.',
          'Data is transmitted over HTTPS. Authentication, data access rules, and private Storage restrict unauthorized reading and modification.',
        ],
      },
      {
        title: '4. Photos and Photo Library access',
        paragraphs: [
          'HomeyPaw requests Photo Library access only when you choose a pet avatar or journal photo. Photos you choose to upload are processed by the app, stored in private Storage, and displayed through time-limited, permission-protected links.',
          'Only family members who still have access to the relevant pet can obtain those photos. The website and app do not publicly display private family photos.',
        ],
      },
      {
        title: '5. Family sharing',
        paragraphs: [
          'A pet Owner can invite trusted people through a private invite. Active family members can view or manage shared journals, photos, care information, and reminders for that pet according to their role.',
          'A removed member loses new access. Content they previously created follows the product’s current data lifecycle. Invite only people you trust and protect invite codes.',
        ],
      },
      {
        title: '6. Local notifications',
        paragraphs: [
          'Care reminders are primarily scheduled locally by HomeyPaw on your device. You may decline notification permission or change it in iOS Settings. HomeyPaw does not currently obtain a remote push token or use remote push notifications.',
        ],
      },
      {
        title: '7. Information we do not currently collect',
        paragraphs: [
          'HomeyPaw does not currently request or collect precise GPS location, contacts, microphone data, camera data, advertising identifiers, or cross-app tracking data. A journal location name is stored only when you type it, and photos are selected by you through the system photo picker.',
        ],
      },
      {
        title: '8. Account deletion and retention',
        paragraphs: [
          'You can permanently delete your account in “Me → Account and security.” Deletion removes the sign-in account and Profile, along with shared journal entries, photos, care logs, and task completions you created.',
          'If you are a pet Owner, deletion also removes pets you own and their related memberships, journals, media, care records, and tasks. If a Member deletes an account, some family care tasks they created may remain so important care plans do not suddenly disappear, but the creator identity is removed.',
          'A deletion request removes applicable data from HomeyPaw’s active systems. Infrastructure providers may retain technical backups for a limited period under their backup and security processes.',
        ],
      },
      {
        title: '9. Security',
        paragraphs: [
          'We use reasonable technical and organizational measures — including authenticated access, row-level data permissions, private file storage, and HTTPS transport — to reduce the risk of unauthorized access, alteration, or disclosure. No online service can guarantee absolute security.',
        ],
      },
      {
        title: '10. Children',
        paragraphs: [
          'HomeyPaw is a family pet record tool and is not directed primarily at children. A parent or guardian who believes a child provided personal information without appropriate consent should contact us.',
        ],
      },
      {
        title: '11. Updates and contact',
        paragraphs: [
          'We may update this policy when features or data handling practices materially change. The current update date will appear on this page.',
          'For privacy, data, or deletion questions, email lenny996@163.com.',
        ],
      },
    ],
    lastUpdated: 'Last updated: August 26, 2026',
  },
  terms: {
    eyebrow: 'Using HomeyPaw',
    title: 'Terms of Service',
    intro:
      'These plain-language terms describe your responsibilities and reasonable expectations when using HomeyPaw as a private family pet space.',
    sections: [
      {
        title: '1. Eligibility and lawful use',
        paragraphs: [
          'By using HomeyPaw, you agree to use it lawfully for private family pet records and care coordination, and confirm that you can agree to these terms. If you use the service for someone else, you must have authority to make the relevant decisions.',
        ],
      },
      {
        title: '2. Accounts',
        paragraphs: [
          'You are responsible for providing accurate information, protecting your sign-in credentials, and activity under your account. If you discover unauthorized access, change your password and contact us as soon as practical.',
        ],
      },
      {
        title: '3. Family sharing',
        paragraphs: [
          'HomeyPaw Family Spaces are private and invite-only. Invite only people you trust and keep invite codes secure. An Owner can manage the pet, invites, members, and family content; a Member’s access follows the role rules shown in the app.',
          'A removed member loses new access. Family members should coordinate important care plans with each other and should not depend on a single device or reminder.',
        ],
      },
      {
        title: '4. Your content',
        paragraphs: [
          'You retain your rights in the text and photos you upload and confirm that you have the right to use and share them. You allow HomeyPaw to store, process, copy, and display that content to authorized family members only as needed to provide the service.',
          'HomeyPaw does not take ownership of your content because you upload it.',
        ],
      },
      {
        title: '5. Prohibited use',
        paragraphs: ['You must not use HomeyPaw to:'],
        bullets: [
          'Upload unlawful, infringing, fraudulent, threatening, or abusive material.',
          'Access another account, family, or data without authorization.',
          'Bypass, interfere with, or probe security or access restrictions.',
          'Distribute malware, disrupt the service, or consume system resources unreasonably.',
        ],
      },
      {
        title: '6. Pet health and reminders',
        paragraphs: [
          'HomeyPaw is not a veterinary, medical, or emergency service. Care records and reminders are family coordination tools and do not replace veterinary advice, diagnosis, treatment, or reliable emergency arrangements.',
          'For important medication or care, use appropriate professional services and backup reminders. Do not rely on app notifications alone.',
        ],
      },
      {
        title: '7. Service availability',
        paragraphs: [
          'We work to keep HomeyPaw available, but network conditions, device permissions, providers, maintenance, or technical issues may temporarily interrupt, delay, or prevent features. Features may change to improve security, reliability, or the product.',
        ],
      },
      {
        title: '8. Account deletion and stopping use',
        paragraphs: [
          'You may stop using HomeyPaw at any time and permanently delete your account in the app. Deleting an account, pet, journal entry, or photo cannot be undone. Data is handled according to the Privacy Policy and the confirmation shown in the app.',
          'If an account is used for illegal activity, abuse, unauthorized access, or serious disruption, we may take reasonable steps to restrict use to protect other users and the service.',
        ],
      },
      {
        title: '9. Reasonable limits of responsibility',
        paragraphs: [
          'To the extent permitted by applicable law, HomeyPaw is provided as available and does not promise uninterrupted or error-free service. We are not responsible for losses caused by treating HomeyPaw as a veterinary, medical, emergency, or sole reminder service.',
          'Nothing in these terms excludes or limits any right or responsibility that applicable law does not allow to be excluded or limited.',
        ],
      },
      {
        title: '10. Updates and contact',
        paragraphs: [
          'We may update these terms when the service materially changes and will show the current update date on this page. Review the latest version before continuing to use the service.',
          'For questions about these terms or the service, email lenny996@163.com.',
        ],
      },
    ],
    lastUpdated: 'Last updated: August 26, 2026',
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
