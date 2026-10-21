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

## `getPositions&shortcut=true` — seen in a real answer (2026-10-21)

`application/json;charset=utf-8`, a list: the server's wall-clock time (Wrocław) first, then one
object per vehicle (~480 at midday):

```json
["2026-10-21 13:40:50",
 {"v":4102,"c":29086669,"x":17.091331,"y":51.11346,"l":"715","t":"b","s":"24313","d":"24708","e":0},
 {"v":3102,"c":29256014,"x":16.993567,"y":51.121353,"l":"3","t":"t","s":"12202","d":"25013","e":-31000}]
```

| Field | Meaning |
|---|---|
| `v` | side number |
| `c` | course (run) id |
| `x`, `y` | longitude, latitude |
| `l` | line |
| `t` | `t` tram, `b` bus |
| `s`, `d` | post symbols; `d` repeats per line, so it is read as the terminus |
| `e` | delay in ms; taken as positive = late (not yet checked against the official app) |

Without `shortcut=true` the same answer spells the keys out (seen 2026-10-21): `code` (= `v`),
`course` (= `c`), `x`, `y`, `line` (= `l`), `type` `"BUS"`/`"TRAM"` (= `t`), `symbol` (= `s`, the current
post), `direction` (= `d`), `delay` (= `e`). That confirms the short keys' meaning. Some `direction`
values are not 5-digit post symbols (e.g. `"50000057"` on line 100). Extra parameters such as
`symbol=…` are ignored by `getPositions`.

Other names in the APK without a confirmed URL (`getPosts`, `getPostsLines`, `getLines`,
`getVehicles`, `getVehiclesInfo`, `getCourse`, …) may be client methods, not operations.
The APK also carries TrustKit, i.e. the official app pins the server's certificate: a normal,
valid certificate is expected, and this app keeps the platform's checks as they are.
