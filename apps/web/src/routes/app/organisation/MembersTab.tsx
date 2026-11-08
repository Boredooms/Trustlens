import { useState } from "react";
import { UserPlus } from "lucide-react";
import { CopyButton, TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Overlay";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import { useInviteMember, useMe, useOrgMembers, useRemoveMember, useRevokeInvite, useUpdateMember } from "@/lib/query/hooks";
import { isApiError } from "@/lib/api/errors";
import type { MemberInvited, OrgInvite, OrgMember } from "@/lib/api/types";
import { ERROR_HINT, ORG_ROLES, ORG_ROLE_LABEL } from "@/lib/copy";
import { toast } from "@/stores/toast";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function roleLabel(role: string): string {
  return ORG_ROLE_LABEL[role] ?? role;
}

function InviteDialog({ orgId, open, onOpenChange }: { orgId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invite = useInviteMember(orgId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("org_member");
  const [touched, setTouched] = useState(false);
  const result: MemberInvited | undefined = invite.data;
  const emailError = !EMAIL.test(email.trim()) ? "Enter the person’s email address." : null;
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      invite.reset();
      setEmail("");
      setRole("org_member");
      setTouched(false);
    }
  };
  const submit = () => {
    setTouched(true);
    if (emailError) return;
    invite.mutate(
      { email: email.trim(), role },
      { onSuccess: (r) => toast.success("Invitation created", r?.delivery === "email" ? `Sent to ${email.trim()}` : undefined) },
    );
  };
  return (
    <Modal
      open={open}
      onOpenChange={close}
      dismissable={!invite.isPending}
      title={result ? "Invitation ready" : "Invite a member"}
      description={result ? undefined : "The invitation link works once and expires. The person signs in with the invited email to accept."}
      footer={
        result ? (
          <Button variant="primary" onClick={() => close(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => close(false)} disabled={invite.isPending}>
              Cancel
            </Button>
            <Button variant="primary" loading={invite.isPending} onClick={submit}>
              Send invitation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div role="status" className="flex flex-col gap-3 text-sm">
          <p>
            {result.delivery === "email" ? "We emailed the invitation to " : "Invitation created for "}
            <span className="font-mono">{result.email ?? email.trim()}</span> as {roleLabel(result.role ?? role)}. It expires{" "}
            <TimeText iso={result.expires_at} mode="absolute" />.
          </p>
          {result.accept_url ? (
            <>
              <Banner tone="neutral" title="Email was not sent">
                Share this link with the person directly. Anyone with the link who signs in with the invited email can join.
              </Banner>
              <div className="flex items-start justify-between gap-3 rounded-sm border border-border bg-surface-secondary px-3 py-2">
                <span className="min-w-0 break-all font-mono text-xs">{result.accept_url}</span>
                <CopyButton value={result.accept_url} label="Copy link" className="shrink-0" />
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Email" required error={touched ? emailError : null}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Role" help={role === "org_admin" ? "Administrators manage the profile, domains, payees, members and monitors." : "Members can read the profile and its checks."}>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          {invite.isError ? <ErrorState error={invite.error} title="The invitation was not created" compact /> : null}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}

function RoleSelect({ orgId, member, disabled }: { orgId: string; member: OrgMember; disabled: boolean }) {
  const update = useUpdateMember(orgId);
  return (
    <div className="flex flex-col items-start gap-1">
      <Select
        aria-label={`Role for ${member.email}`}
        className="h-8 w-40 text-xs"
        value={member.role}
        disabled={disabled || update.isPending}
        onChange={(e) => {
          const role = e.target.value;
          update.mutate(
            { userId: member.user_id, role },
            {
              onSuccess: () => toast.success("Role changed", `${member.email} is now ${roleLabel(role)}.`),
              onError: (err) =>
                toast.error(
                  "The role did not change",
                  isApiError(err) && err.code === "LAST_ADMIN_REMOVAL" ? ERROR_HINT.LAST_ADMIN_REMOVAL : isApiError(err) ? err.message : undefined,
                ),
            },
          );
        }}
      >
        {ORG_ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(r)}
          </option>
        ))}
      </Select>
    </div>
  );
}

function Invites({ orgId, invites }: { orgId: string; invites: OrgInvite[] }) {
  const revoke = useRevokeInvite(orgId);
  if (invites.length === 0) return null;
  return (
    <div className="border-t border-border">
      <h3 className="px-5 pt-4 text-xs font-medium text-muted">Open invitations</h3>
      <ul className="divide-y divide-border px-5 pb-2">
        {invites.map((i) => (
          <li key={i.id} className="row-density flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs">{i.email}</p>
              <p className="text-xs text-muted">
                {roleLabel(i.role)} · expires <TimeText iso={i.expires_at} />
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              loading={revoke.isPending && revoke.variables === i.id}
              onClick={() =>
                revoke.mutate(i.id, {
                  onSuccess: () => toast.success("Invitation revoked", i.email),
                  onError: (err) => toast.error("The invitation was not revoked", isApiError(err) ? err.message : undefined),
                })
              }
            >
              Revoke<span className="sr-only"> invitation for {i.email}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MembersTab({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const q = useOrgMembers(orgId);
  const remove = useRemoveMember(orgId);
  const me = useMe().data;
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<OrgMember | null>(null);
  const rows = q.data?.data ?? [];
  const admins = rows.filter((m) => m.role === "org_admin").length;
  const inviteButton = canManage ? (
    <Button size="sm" variant="primary" onClick={() => setInviting(true)}>
      <UserPlus aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
      Invite member
    </Button>
  ) : null;

  return (
    <Card title="Members" actions={inviteButton} bodyClassName="p-0">
      {q.isPending ? (
        <div className="p-5">
          <SkeletonRows rows={3} label="Loading members" />
        </div>
      ) : q.isError ? (
        <ErrorState className="m-5" error={q.error} title="We could not load members" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState className="px-5" title="No members yet" description="Invite the people who manage this organisation’s profile." action={inviteButton} />
      ) : (
        <Table caption="Members">
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th className="hidden md:table-cell">Joined</Th>
              {canManage ? (
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const lastAdmin = m.role === "org_admin" && admins <= 1;
              return (
                <Tr key={m.user_id}>
                  <Td>
                    <p className="text-sm">
                      {m.display_name || m.email}
                      {me && me.id === m.user_id ? <span className="ml-1 text-xs text-muted">(you)</span> : null}
                    </p>
                    {m.display_name ? <p className="break-all font-mono text-xs text-muted">{m.email}</p> : null}
                  </Td>
                  <Td>
                    {canManage ? (
                      <>
                        <RoleSelect orgId={orgId} member={m} disabled={lastAdmin} />
                        {lastAdmin ? <p className="mt-1 text-xs text-muted">Last administrator</p> : null}
                      </>
                    ) : (
                      <span className="text-muted-strong">{roleLabel(m.role)}</span>
                    )}
                  </Td>
                  <Td className="hidden text-muted-strong md:table-cell">
                    <TimeText iso={m.created_at} />
                  </Td>
                  {canManage ? (
                    <Td align="right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={lastAdmin}
                        title={lastAdmin ? "An organisation must keep at least one administrator." : undefined}
                        onClick={() => setRemoving(m)}
                      >
                        Remove<span className="sr-only"> {m.email}</span>
                      </Button>
                    </Td>
                  ) : null}
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {canManage && q.data?.invites ? <Invites orgId={orgId} invites={q.data.invites} /> : null}
      {canManage ? <InviteDialog orgId={orgId} open={inviting} onOpenChange={setInviting} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRemoving(null);
            remove.reset();
          }
        }}
        title="Remove this member?"
        consequence={removing ? `${removing.email} loses access to this organisation immediately. They can be invited again later.` : undefined}
        confirmLabel="Remove member"
        pending={remove.isPending}
        error={remove.isError ? remove.error : null}
        errorTitle="The member was not removed"
        onConfirm={() =>
          removing &&
          remove.mutate(removing.user_id, {
            onSuccess: () => {
              toast.success("Member removed", removing.email);
              setRemoving(null);
            },
          })
        }
      />
    </Card>
  );
}
