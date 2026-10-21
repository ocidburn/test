# iMPK API — what is known

Used with MPK's permission and the user's own login (Data screen). Source: the user's static
analysis of the iMPK 3.0.511 APK — URL templates only, **no response formats**. Do not write a
parser from guesses; take real answers from the Data screen's request box or `curl --digest`.

Base: `https://impk.mpk.wroc.pl:8088/mobile?function=<operation>` (probably GET; values URL-encoded).

| Operation | Parameters seen in the APK | Notes |
|---|---|---|
| `checkVersion` | `major, minor, revision, posts, postsLines, lines, vehiclesInfo` | versions of reference sets |
| `getPositions` | `shortcut=true`, `date` | `date` format unknown |
| `getCoursePosts` | `course` or `courses` | separator for `courses` unknown |
| `getPostInfo` | `symbol` | |
| `getPostGroupInfo` | `symbol` | |
| `getPostPlate` | `post, line, output=html` | asks for HTML |
| `getVehicleImage` | `model, hash` | |

Other names in the APK without a confirmed URL (`getPosts`, `getPostsLines`, `getLines`,
`getVehicles`, `getVehiclesInfo`, `getCourse`, …) may be client methods, not operations.
The APK also carries TrustKit, i.e. the official app pins the server's certificate: a normal,
valid certificate is expected, and this app keeps the platform's checks as they are.
