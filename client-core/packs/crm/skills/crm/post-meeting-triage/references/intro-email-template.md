# Intro Email Template (WhatsApp-triggered)

Use when user has coordinated via WhatsApp (e.g. pulled contact email) and wants a 3-way intro without offering a call.

**Subject:** Intro: [Full Name A] ([Company A]) <> [Full Name B] ([Company B])

**Body:**

Hi [FirstA] and [FirstB],

I wanted to connect the two of you.

[FirstA] — you're building [one-sentence relevant context, e.g. Floracene around medical supplies and GPO purchasing for ASCs].

[FirstB] — your family runs [one-sentence, e.g. Example Clinic / Example Clinic Network with multiple IVF centers and a licensed surgical center].

Given the overlap, I thought you should know each other.

I'll let you take it from here.

Best,  
<SenderEmail>

**gws command pattern:** same base64 raw encoding as follow-ups, using `gws gmail users drafts create --params '{"userId":"me"}' --json '{"message":{"raw":"..."}}'`

This variant was requested in June 2026 two-contact intro case.