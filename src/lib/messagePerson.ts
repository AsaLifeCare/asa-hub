// "MESSAGE <PERSON>" — one door, from any screen that knows a name.
// The platform has a chat now, so a button offering to message somebody has somewhere real to go.
import { cachedUsers, fetchUsers, findAccountByName } from '@/lib/usersDirectory'
import { toast } from '@/stores/useToastStore'


// Opens the chat on this person's conversation, or says why it cannot.
export async function messagePerson(name: string, navigate: (to: string) => void): Promise<void> {
  const seed = cachedUsers()
  let found = seed ? findAccountByName(seed, name) : null
  if (!found) {
    try {
      found = findAccountByName(await fetchUsers(), name)
    } catch {
      toast({ type: 'danger', title: 'Could not open the chat', body: 'The accounts directory did not answer — try again in a moment.' })
      return
    }
  }
  if (!found?.id) {
    toast({
      type: 'warning',
      title: `${name} has no platform account`,
      body: 'Only people who sign in to asa. can be messaged here. An admin can invite them in Settings → Users.',
    })
    return
  }
  navigate(`/app/chat/messages?with=${encodeURIComponent(found.id)}`)
}
