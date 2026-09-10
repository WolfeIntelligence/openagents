// Site-wide constants shared by legal pages, metadata, and anywhere else that needs to
// refer to the product's name, canonical URL, or a contact address without hardcoding it
// in multiple places.

export const SITE_NAME = "OpenAgents";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://openagents-nu.vercel.app";

/** Placeholder contact address used for privacy, support, and legal inquiries until
 *  dedicated mailboxes (privacy@, support@) exist. */
export const CONTACT_EMAIL = "zwolfe42@gmail.com";
