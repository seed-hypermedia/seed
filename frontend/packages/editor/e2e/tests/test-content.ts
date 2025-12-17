/**
 * Test content for copy-paste E2E tests.
 * This file contains hardcoded content that simulates
 * external sources (HTML, Markdown) and internal Seed content.
 */

// =============================================================================
// HTML Content (simulating paste from external sources)
// =============================================================================

export const htmlContent = {
  // Multiple paragraphs
  multiParagraphHTML: `<p>First paragraph</p><p>Second paragraph</p><p>Third paragraph</p>`,

  // Basic text with inline formatting
  boldText: '<p>The <strong>important</strong> message</p>',
  italicText: '<p>An <em>emphasized</em> phrase</p>',
  mixedFormatting:
    '<p>This has <strong>strong</strong>, <em>emphasis</em>, and <u>underlined</u> words</p>',

  // Links
  simpleLink: '<p>Visit <a href="https://example.com">Example Site</a></p>',
  multiplLinks:
    '<p><a href="https://one.com">One</a> and <a href="https://two.com">Two</a></p>',

  // Lists
  unorderedList: `<ul>
    <li>Item 1</li>
    <li>Item 2</li>
    <li>Item 3</li>
  </ul>`,

  orderedList: `<ol>
    <li>Item 1</li>
    <li>Item 2</li>
    <li>Item 3</li>
  </ol>`,

  nestedList: `<ul>
    <li>Parent item
      <ul>
        <li>Child item 1</li>
        <li>Child item 2</li>
      </ul>
    </li>
    <li>Another parent</li>
  </ul>`,

  // Blockquotes
  blockquote: '<blockquote>This is a quoted text from somewhere</blockquote>',
  nestedBlockquote:
    '<blockquote>Quote level 1<blockquote>Quote level 2</blockquote></blockquote>',

  // Headings
  heading1: '<h1>Main Heading</h1>',
  heading2: '<h2>Subheading</h2>',
  headingWithText: '<h2>My Heading</h2><p>Some paragraph text below</p>',

  // Code
  inlineCode: '<p>Use the <code>console.log()</code> function</p>',
  codeBlock: '<pre><code>function hello() {\n  return "world";\n}</code></pre>',

  complexDocument:
    '<h2>Project Overview</h2><p>This is a <strong>complex</strong> document.</p><p>Learn more at our website.</p>',

  // Paste from Google Docs
  googleDocs: {
    // Example: Copy some formatted text from Google Docs and paste the HTML
    formattedText: `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-8b65b5ca-7fff-a003-22e2-cd527dcaccf6"><h1 dir="ltr" style="line-height:1.38;background-color:#ffffff;margin-top:20pt;margin-bottom:0pt;padding:0pt 0pt 15pt 0pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Some article</span></h1><p dir="ltr" style="line-height:1.38;background-color:#ffffff;margin-top:0pt;margin-bottom:0pt;padding:0pt 0pt 15pt 0pt;"><span style="font-size:13pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">If eyes are the window to the soul</span><span style="font-size:13pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">, then it is especially convenient that Travis McHenry&rsquo;s eyes are the cool blue of crushed glaciers, of wind-whittled ice reflecting the polar sun. Because even though McHenry is by every account a warm person—a true quick-witted, playful Gemini, apt to change and change again—it is somehow fitting that his eyes mirror a piece of frozen, barren land he&rsquo;s laid claim to for more than half his life, never mind that he&rsquo;s actually never been there: 620,000 square miles of Antarctica he&rsquo;s dubbed Westarctica, a micronation he&rsquo;s &ldquo;ruled&rdquo; as His Royal Highness Travis I, Grand Duke, since 2001. It is land that he is irrevocably connected to. Perhaps it is part of his soul.</span></p><p dir="ltr" style="line-height:1.38;background-color:#ffffff;margin-top:0pt;margin-bottom:0pt;padding:0pt 0pt 15pt 0pt;"><span style="font-size:13pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Before his reign, McHenry began his life in Benton, Pennsylvania, which sits 230 miles east of Pittsburgh in a valley between bumpy hills, houses dotted here and there, as if they were marbles that had rolled down grassy slopes and merely lost momentum. There is a sub shop and a Dollar General and a population of 755 people. McHenry&rsquo;s relatives were original settlers of the town, and despite lore and legend and even local gravitas growing up—living next to </span><span style="font-size:13pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:italic;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Nomadland</span><span style="font-size:13pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;"> actor Frances McDormand, whose father was the pastor at Benton Christian Church—McHenry can&rsquo;t remember a time when he didn&rsquo;t wish for something more. &ldquo;Ever since I was little, I had a yearning to go someplace bigger,&rdquo; McHenry, now 41, says. &ldquo;I always had dreams of making something of myself.&rdquo;</span></p><p dir="ltr" style="line-height:1.38;background-color:#ffffff;margin-top:0pt;margin-bottom:0pt;padding:0pt 0pt 15pt 0pt;"><span style="font-size:13pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">In elementary school, McHenry was an unexceptional student, and on report cards, teachers expressed disappointment—he was a distraction to others, a ham. He had too much energy. By high school, he&rsquo;d found his footing, sort of, becoming interested in history, English, and acting. After graduation, he began studying theater at Bloomsburg University of Pennsylvania, 16 miles south of Benton. He read up on acting technique, tooled around with Stanislavski and Meisner methods. But after three and a half years, he felt more of a pull toward a bigger purpose. Clichéd, corny as it sounds, he wanted to make a difference. With what he calls &ldquo;dreams of grandeur,&rdquo; he enrolled in the Navy in January 2001, working as an antiterrorism intelligence specialist, floating the world on the USS </span><span style="font-size:13pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:italic;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Kearsarge</span><span style="font-size:13pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">.</span></p><br /></b></meta></meta>`,
    list: `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-38942459-7fff-efc4-12aa-d138c8d8979c"><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Test 1</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Test 2</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Test 3</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Test 4</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Test 5</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Test 5.1</span></p></li><li dir="ltr" style="list-style-type:circle;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="2"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Test 5.2</span></p></li></ul></ul></b></meta></meta>`,
  },

  // Paste from Notion
  notion: {
    formattedText: `<meta charset='utf-8'><p>Notion <strong>bold</strong> and <em>italic</em></p>`,
    list: `<meta charset='utf-8'><ul><li>Notion item 1</li><li>Notion item 2</li></ul>`,
    // Notion often includes data attributes
    toggle: `<meta charset='utf-8'><details><summary>Toggle heading</summary><p>Toggle content</p></details>`,
  },

  // Paste from ChatGPT web app
  chatGpt: {
    formattedText: `<meta charset='utf-8'><h3 data-start="168" data-end="202"><strong data-start="172" data-end="202">✔ DC IN → charging / power</strong></h3>
      <ul data-start="203" data-end="409">
      <li data-start="203" data-end="253">
      <p data-start="205" data-end="253">This is the weird-shaped proprietary connector</p>
      </li>
      <li data-start="254" data-end="311">
      <p data-start="256" data-end="311">Used with JVC AC adapters (AP-V20U, AP-V21U, AP-V25U)</p>
      </li>
      <li data-start="312" data-end="346">
      <p data-start="314" data-end="346">Supplies ~11V DC to the camera</p>
      </li>
      <li data-start="347" data-end="409">
      <p data-start="349" data-end="409">Charges the battery <em data-start="369" data-end="409">only while it’s attached to the camera</em></p>
      </li>
      </ul>
      <h3 data-start="411" data-end="448"><strong data-start="415" data-end="448">✘ AV OUT → video/audio output</strong></h3>
      <ul data-start="449" data-end="581">
      <li data-start="449" data-end="522">
      <p data-start="451" data-end="522">Looks like a small “rounded rectangle” or “flat 3.5mm-like” connector</p>
      </li>
      <li data-start="523" data-end="550">
      <p data-start="525" data-end="550">Used to connect to a TV</p>
      </li>
      <li data-start="551" data-end="581">
      <p data-start="553" data-end="581"><strong data-start="553" data-end="581">Cannot charge the camera</strong></p>
      </li>
      </ul>
      <hr data-start="583" data-end="586">
      <h1 data-start="588" data-end="628">🔍 <strong data-start="593" data-end="628">How to identify the correct one</strong></h1>
      <ul data-start="629" data-end="832">
      <li data-start="629" data-end="696">
      <p data-start="631" data-end="696">The <strong data-start="635" data-end="644">DC IN</strong> port usually says:<br data-start="663" data-end="666">
      <strong data-start="668" data-end="696">“DC 11V” or just “DC IN”</strong></p>
      </li>
      <li data-start="697" data-end="749">
      <p data-start="699" data-end="749">Shape: <strong data-start="706" data-end="749">flat, wide, 2-pin proprietary connector</strong></p>
      </li>
      <li data-start="750" data-end="832">
      <p data-start="752" data-end="832">The <strong data-start="756" data-end="762">AV</strong> port is usually labeled <strong data-start="787" data-end="793">AV</strong>, <strong data-start="795" data-end="802">A/V</strong>, or has a little screen icon.</p>
      </li>
      </ul>
      <p data-start="834" data-end="921">If you want, you can send me a photo of the ports and I’ll confirm 100% which is which.</p>
      <hr data-start="923" data-end="926">
      <h1 data-start="928" data-end="941">⚠ Important</h1>
      <p data-start="942" data-end="1007">If your parents no longer have the JVC charger, you <strong data-start="994" data-end="1002">must</strong> buy:</p>
      <ul data-start="1008" data-end="1100">
      <li data-start="1008" data-end="1046">
      <p data-start="1010" data-end="1046">The correct <strong data-start="1022" data-end="1040">JVC AC adapter</strong>, or</p>
      </li>
      <li data-start="1047" data-end="1100">
      <p data-start="1049" data-end="1100">A <strong data-start="1051" data-end="1085">BN-VF external battery charger</strong> (much cheaper)</p>
      </li>
      </ul>
      <p data-start="1102" data-end="1169">Universal chargers usually don’t fit that proprietary DC connector.</p>
      <hr data-start="1171" data-end="1174">
      <p data-start="1176" data-end="1322" data-is-last-node="" data-is-only-node="">If you tell me the exact Everio model (e.g., GZ-MG330, GZ-MG360, GZ-MG275, etc.), I can show you the exact charger and battery type for your unit.</p>
    `,
  },
}

// =============================================================================
// Plain text versions
// =============================================================================

export const plainTextContent = {
  singleLine: 'Hello World',
  multiLine: `Line 1\nLine 2\nLine 3`,

  multiParagraph: `First paragraph

Second paragraph

Third paragraph`,

  unorderedListLike: `- Item 1
- Item 2
- Item 3`,

  numberedListLike: `1. Item 1
2. Item 2
3. Item 3`,
}

// =============================================================================
// Markdown content
// =============================================================================

export const markdownContent = {
  heading: '# Main Heading',
  subheading: '## Subheading',

  bold: '**bold text**',
  italic: '*italic text*',
  mixed: 'Text with **bold** and *italic* words',

  link: '[Example](https://example.com)',

  unorderedList: `- Item 1
- Item 2
- Item 3`,

  orderedList: `1. Item 1
2. Item 2
3. Item 3`,

  blockquote: '> This is a quote',

  code: '`inline code`',
  codeBlock: '```\nfunction hello() {\n  return "world";\n}\n```',

  complexDocument: `# Document Title

This is a paragraph with **bold** and *italic* text.

## Features

- Feature one
- Feature two
- Feature three

> Important note

Visit [our site](https://example.com) for more.`,
}

// =============================================================================
// Seed blocks
// =============================================================================

export const seedBlockHTML = {
  // Embed block - Card view
  embedCard: `<meta charset='utf-8'><div data-content-type="embed" data-url="hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou/test-doc" data-view="Card" data-pm-slice="0 0 []"><div> </div></div>`,

  // Embed block - Content view
  embedContent: `<meta charset='utf-8'><div data-content-type="embed" data-url="hm://z6MkrbYsRzKb1VABdvhsDSAk6JK8fAszKsyHhcaZigYeWCou/test-doc" data-pm-slice="0 0 []"><div> </div></div>`,

  // Image block
  image: `<meta charset='utf-8'><div data-content-type="image" data-url="ipfs://bafkreib3quvx7kxnef7jldba3xee5eqy4xx3fyy2644xamt777qxz7t4se" data-display-src="http://localhost:58001/ipfs/bafkreib3quvx7kxnef7jldba3xee5eqy4xx3fyy2644xamt777qxz7t4se" data-name="test-image.jpg" data-width="319" data-default-open="true" data-pm-slice="0 0 []"><div></div></div>`,
}

// =============================================================================
// Helper to create clipboard data
// =============================================================================

export function createClipboardHTML(
  html: string,
  plainText?: string,
): {html: string; plain: string} {
  return {
    html,
    plain: plainText || html.replace(/<[^>]*>/g, ''),
  }
}
