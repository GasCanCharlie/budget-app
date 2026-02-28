// Redirects old /triage URL to the renamed /categorize page
import { redirect } from 'next/navigation'

export default function TriageRedirect() {
  redirect('/categorize')
}
