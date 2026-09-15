---
name: Extension
summary: 'a reference node that _also_ carries refinements (`{ "ref": parent, "properties": {…} }`).'
---
**Extension** — a reference node that _also_ carries refinements (`{ "ref": parent, "properties": {…} }`). A subtype: the parent's fields plus the new ones, each a property that says whether it is required; closedness preserved. No `extends` keyword — the presence of refinements is what distinguishes it from a bare <hm://z6MkoAVbUvhqBBkJ8CU9aDhn13UUu4UePixQdPFYumn5gsW3/schema/include-schema?v=bafyreihrqa5xrgzfbv73mbghzomjt3uz6axvhatocfi7gjr3hprpqwltuq&l>. Example: `example/employee` extends `example/person`. ([the schema language](./schema-language.md)) <!-- id:IoC_acS3 -->
