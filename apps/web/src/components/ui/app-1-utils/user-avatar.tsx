import { useUser } from "@clerk/clerk-react";
import { AvatarImage } from "@/components/ui/avatar";

/**
 * The signed-in person's Clerk profile image. Render only when auth mode is "clerk" (it needs
 * <ClerkProvider>). Radix Avatar keeps the initials fallback until — and unless — the image loads.
 * Clerk's default "initials" placeholder image is skipped so our token-styled initials show instead.
 */
export function UserAvatarImage() {
  const { user } = useUser();
  if (!user?.hasImage || !user.imageUrl) return null;
  return <AvatarImage src={user.imageUrl} alt="" referrerPolicy="no-referrer" />;
}
