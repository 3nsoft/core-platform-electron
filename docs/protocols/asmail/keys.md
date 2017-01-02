# ASMail message keys

ASMail message has one or more binary blobs, packed according to XSP-file format.
One of the objects is main.
When main object is open, all other objects can be opened in a hierarchical way.
Thus, to open ASMail message, one needs a master key for main object.

Master key for XSP object is a 256-bit/32-byte array.
[NaCl](http://nacl.cr.yp.to/) library has public-key crypto box.
It is setup so that for every pair of public keys we calculate a 256-bit array that is a shared key, in a Diffie-Hellman sense.
Shared key is used as a master key for main object.
Yet, when we say *message keys*, we talk about public keys, from which main object's master key is derived.


## Keys' flow

There are two roles of message keys, used in ASMail:

 1. Introductory key, is used to send a message to a contact, when there are no known ephemeral keys for the contact.

 2. Ephemeral keys are used in all other instances.

### 1st phase: use of introductory keys

When sender *A* wants to send a message to *B*, *B*'s introductory public is needed.

*A* could've gotten *B*'s introductory (public) key (`KPub_B_0`) offline from *B*, or from a mutual friend, via a trusted channel.
Alternatively, if *A* doesn't have this most secure option, *B*'s server is asked to provide `KPub_B_0`, registered by *B*.
`KPub_B_0` comes from server with *B*'s MailerId signature and respective certificates, so that, *A* can be assured that the key was indeed created by *B*, and wasn't substituted by *B*'s mail server. (Note: such guarantee is stronger, when provider of mail sever is not the same as provider of MailerId identity service).

*A* generates new random key, to use as introductory key (`K_A_0`).
*A* creates MailerId signature for public part of the key (`KPub_A_0`), and places it together with certificates into message's main object.

*A* generates first ephemeral random key, and places its public part `KPub_A_1` into message's main object, as next crypto.
Next crypto has one or more pair ids (`Pid_A1_B0`), associated with pair `[ K_A_1, K_B_0 ]`, which should be used by *B* to send a reply.

*A* encrypts the whole message, and uses secret part of its key to close message with a pair `[ KSec_A_0, KPub_B_0 ]`.

When sending a message, *A* provides in plain text `KPub_A_0`, and an id of `KPub_B_0`.
This information is enough for *B* to identify its `KSec_B_0` and to open the message. 

When *B* opens the message, with pair `[ KPub_A_0, KSec_B_0 ]`, it must look for MailerId certification of an introductory one-time key `KPub_A_0`, and check it in accordance with MailerId protocol.
Without such check, identity of the sender cannot be established, and, therefore, message content cannot be trusted.

### 2nd phase: use of ephemeral keys

Once *B* is assured that `KPub_A_0` belongs to *A*, it may record next crypto pair, suggested by *A* (`[ K_A_1, K_B_0 ]`).

To send message to *A*, *B* generates a new key `K_B_1`, and records its public part in the message's main object as a part of a next crypto pair `[ K_A_1, K_B_1 ]`. Associated with key pair are pair ids `Pid_A1_B1`.

*B* encrypts the message with `[ KPub_A_1, KSec_B_0 ]` pair, and provides one of `Pid_A1_B0` ids as plain text, when sending the message to *A*.

When *A* receives a message encrypted with `Pid_A1_B0`, it labels this pair as being in use.
And in the next message, *A* introduces pair `Pid_A2_B1`, while encrypting it to a pair `Pid_A1_B1`, suggested by *B*.

Sender may introduce new key pair only, when the previous one has been used by a recipient.
Otherwise, the same information for next crypto should be added into the message.

### One way messaging

It is possible to have a situation, in which only one side sends messages.
In this case sender is not adding next crypto to its messages.

### Keyrings' dialog

Implementor may think about key sending as a dialog between keyrings of communicating parties.
State of a each keyring is dictated by a few rules for both sending and receiving situations.

Rules for message sending:

 - If there is a sending pair that has been suggested by the other side, use it to encrypt a message.

 - If there is no sending pair, look for known one from an offline introductory key for recipient.
 Else, get recipient's key from mail server.
 Encrypt the message to a pair of introductory keys.

 - If there is a pair that has already been suggested to the other side, but hasn't been used, add it again as next crypto in the main object.
 Else, generate a new pair for the other side.

Rules for message receiving:

 - If a message is encrypted to a pair that has been suggested, but hasn't been used, its status changes to pair in use.

 - Do nothing, if a message is encrypted to a pair in use, or an old pair.

 - When a message contains new suggested pair, keyring should remember it as a new pair for sending messages, and use it when writing a reply.
 Previous pair should be marked as old, and kept, in case there is a not yet arrived message, encrypted to it.

 - Do nothing, when a message doesn't have a suggested pair, or if a pair is the same as the existing one, or an old one.


## Saving messages

When message is kept for a long time, message's main object's file key should be stored, and not message key(s).


## Security considerations

Message keys are updated from time to time.
Although, there can be a couple of messages that are encrypted with same keys, when one sides sends them before getting any message back.

Neither key ids, nor public keys show in plain text.
As a result, mail server has no identifiers in the message to identify certain messages as ones coming from the same sender.

Pair ids are random numbers from 0 to 255.
There should be a couple of ids associated to the same key pair.
Note that ids' shortness provides for collisions.
Collisions provide a cover for those cases, when the same key pair is used a couple of times.