---
name: Extension
summary: 'a reference node that _also_ carries refinements (`{ "ref": parent, "properties": {…}, "required": […] }`).'
---
**Extension** — a reference node that _also_ carries refinements (`{ "ref": parent, "properties": {…}, "required": […] }`). A subtype: the parent's fields plus the new ones, `required` unioned, closedness preserved. No `extends` keyword — the presence of refinements is what distinguishes it from a bare include. Example: `example/employee` extends `example/person`. ([the schema language](./schema-language.md)) <!-- id:IoC_acS3 -->
