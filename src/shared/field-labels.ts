/** Display labels for profile field keys in UI. */
const KEY_LABELS: Record<string, string> = {
  fullName: "Full name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  city: "City",
  region: "State / region",
  postalCode: "Postal code",
  country: "Country",
  organization: "Organization",
  website: "Website",
};

/** Turn `firstName` / `addressLine1` into readable labels. */
export function humanizeFieldKey(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key]!;
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d+)/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
