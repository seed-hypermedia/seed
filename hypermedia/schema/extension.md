---
name: Extension
summary: A Reference Schema that also carries refinements
---
**Extension** — a <hm://z6MkoAVbUvhqBBkJ8CU9aDhn13UUu4UePixQdPFYumn5gsW3/schema/include-schema?v=bafyreifcyf34qbtmmhxwzdq4acwm3jd2sh4lfjeyyhym6fkmhxjhi7gndu&l> that _also_ carries refinements. <!-- id:IoC_acS3 -->

`{ "ref": "hyper.media/struct", "properties": {…} }` <!-- id:vG52Mjgo -->

A subtype: the parent's fields plus the new ones, each a property that says whether it is required. <!-- id:lJDeDmj1 -->

No `extends` keyword — the presence of refinements is what distinguishes it from a bare <hm://z6MkoAVbUvhqBBkJ8CU9aDhn13UUu4UePixQdPFYumn5gsW3/schema/include-schema?v=bafyreihrqa5xrgzfbv73mbghzomjt3uz6axvhatocfi7gjr3hprpqwltuq&l>. <!-- id:drnWeK9F -->

Example: <hm://z6MkoAVbUvhqBBkJ8CU9aDhn13UUu4UePixQdPFYumn5gsW3/example/employee?v=bafyreif4dbxlbqrcru5j4bwfc7ez6fj5vjw6hei3j4hoxqxh2iypbgityq&l> extends <hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-person?v=bafyreie3hf6ter7sq7auyvihcw7y2kcnpu6rs6lnvbyjykq62amdjnqy54&l>\  <!-- id:-NO5_fFA -->
