import {describe, expect, test} from 'bun:test'
import {postprocessConvertedMarkdown} from '@/convert-postprocess'

// Shapes taken from a real Datalab conversion of an ACM paper: captions as plain or bold
// paragraphs next to the image, a `#### 5. REFERENCES` heading with `- [n]` entries, and
// citations as `[1, 2]`, `[3]` in prose.
const PAPER = `# Higher-Order Rank Analysis

The text ![](assets/fig1.jpg) more text.

![](assets/fig1.jpg)

Figure 1: Regular and irregular structures

is easy to handle. Irregular arcs were studied in [1, 2] and the Web as a graph in [3]. See also [4-6], [9] and [12].

**Figure 3: Higher-order rank: rank<sub>0</sub>(A) on a Web graph**

![Figure 3](assets/fig3.jpg)

A [link label](https://example.com/[1]) and a reference-style [x][1] stay as they are.

\`\`\`
code [1] stays
![](assets/code.jpg)
\`\`\`

#### 5. REFERENCES

- [1] Ikumi Horie, "Structural Analysis," 2004.
- [2] Ikumi Horie, "Structural Analysis by the Non-Well-Founded Set," 2004.
- [3] Andrei Broder, "Graph structure in the web," 2000.
- [4] Rodrigo A. Botafofo, "Identifying aggregates," 1991.
- [5] Rodrigo A. Botafofo, "Structural Analysis of Hypertexts," 1992.
- [6] John E. McEneaney, "Graphic and numerical methods," 2001.
- [9] Wang, "Discovering Typical Structures," 1998.

## 6. Appendix

Nothing cites [2] here? It does, and it is linked. But [99] has no entry.
`

describe('postprocessConvertedMarkdown', () => {
  const out = postprocessConvertedMarkdown(PAPER)

  test('folds the adjacent caption paragraph into the image caption', () => {
    expect(out.captionsFolded).toBe(2)
    expect(out.markdown).toContain('![Figure 1: Regular and irregular structures](assets/fig1.jpg)')
    expect(out.markdown).not.toContain('\nFigure 1: Regular and irregular structures\n')
    expect(out.markdown).toContain(
      '![Figure 3: Higher-order rank: rank<sub>0</sub>(A) on a Web graph](assets/fig3.jpg)',
    )
    expect(out.markdown).not.toContain('**Figure 3')
    // The inline image in prose is not a standalone image line and is left for the image rewrite.
    expect(out.markdown).toContain('The text ![](assets/fig1.jpg) more text.')
  })

  test('gives bibliography entries ids and links numeric citations, groups and ranges to them', () => {
    expect(out.referenceEntries).toBe(7)
    expect(out.markdown).toContain('- [1] Ikumi Horie, "Structural Analysis," 2004. <!-- id:ref-1 -->')
    expect(out.markdown).toContain('- [9] Wang, "Discovering Typical Structures," 1998. <!-- id:ref-9 -->')
    expect(out.markdown).toContain('studied in [[1](#ref-1), [2](#ref-2)] and the Web as a graph in [[3](#ref-3)]')
    expect(out.markdown).toContain('See also [[4](#ref-4), [5](#ref-5), [6](#ref-6)], [[9](#ref-9)] and [12].')
    expect(out.markdown).toContain('cites [[2](#ref-2)] here')
    expect(out.citationsLinked).toBe(8)
    expect(out.citationsUnlinked).toEqual(['12', '99'])
  })

  // Shapes from a real conversion of the Sherman et al. ATK paper: `[Author year]` labels on
  // both the entries and the citations, emphasis inside a label, a comma-separated pair.
  test('links labelled author-year citations to entries carrying the same label', () => {
    const src = [
      'Links for hypertext [Meyrowitz 1989]. Built atop ATK [Borenstein *et al.* 1988] had no plan.',
      'The Help system [Langston 1988, Ogura & Robertson 1989] provides help; see [Olivetti undated].',
      'Not cited: [Meyrowitz 1999], [sic] and [Figure 2].',
      '',
      '## References',
      '',
      '- [Atkinson 1987] Atkinson, B., *HyperCard*, Apple Computer, 1987.',
      '- [Borenstein *et al.* 1988] Borenstein, Nathaniel, "A Multi-media Message System for Andrew", 1988.',
      '- [Langston 1988] Langston, Diane, "Background and Initial Problems for the Andrew Help System," 1988.',
      '- [Meyrowitz 1989] Meyrowitz, N., "Hypertext—Does it Reduce Cholesterol, too?", 1989.',
      '- [Ogura & Robertson 1989] Ogura, Ayami, Jennifer Robertson, "Designing Hypermedia Help Systems", 1989.',
      '- [Olivetti undated] "Hypermedia Help System", Olivetti Internal Memo, undated.',
      '',
    ].join('\n')
    const out = postprocessConvertedMarkdown(src)
    expect(out.referenceEntries).toBe(6)
    expect(out.markdown).toContain(
      '- [Atkinson 1987] Atkinson, B., *HyperCard*, Apple Computer, 1987. <!-- id:ref-atkinson-1987 -->',
    )
    expect(out.markdown).toContain('1988. <!-- id:ref-borenstein-et-al-1988 -->')
    expect(out.markdown).toContain('1989. <!-- id:ref-ogura-robertson-1989 -->')
    expect(out.markdown).toContain(
      'Links for hypertext [[Meyrowitz 1989](#ref-meyrowitz-1989)]. Built atop ATK [[Borenstein *et al.* 1988](#ref-borenstein-et-al-1988)] had no plan.',
    )
    expect(out.markdown).toContain(
      'The Help system [[Langston 1988](#ref-langston-1988), [Ogura & Robertson 1989](#ref-ogura-robertson-1989)] provides help; see [[Olivetti undated](#ref-olivetti-undated)].',
    )
    expect(out.markdown).toContain('Not cited: [Meyrowitz 1999], [sic] and [Figure 2].')
    expect(out.citationsLinked).toBe(5)
    expect(out.citationsUnlinked).toEqual(['meyrowitz 1999'])
  })

  test('leaves link labels, reference-style links, code and the bibliography itself alone', () => {
    expect(out.markdown).toContain('[link label](https://example.com/[1])')
    expect(out.markdown).toContain('[x][1] stay')
    expect(out.markdown).toContain('code [1] stays\n![](assets/code.jpg)')
    expect(out.markdown).not.toContain('- [[1](#ref-1)]')
  })

  test('a document without a references section or captions passes through unchanged', () => {
    const plain = '# Title\n\nJust prose with [1] and a table.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
    const result = postprocessConvertedMarkdown(plain)
    expect(result.markdown).toBe(plain)
    expect(result).toMatchObject({captionsFolded: 0, referenceEntries: 0, citationsLinked: 0, citationsUnlinked: []})
  })

  test('keeps an existing block id on a bibliography entry and does not stack captions', () => {
    const src =
      '![](a.png) <!-- id:imgAAAAA -->\n\nFig. 2. Two things\n\nAs in [1].\n\n## References\n\n1. First <!-- id:keepMe12 -->\n'
    const result = postprocessConvertedMarkdown(src)
    expect(result.markdown).toBe(
      '![Fig. 2: Two things](a.png) <!-- id:imgAAAAA -->\n\nAs in [[1](#keepMe12)].\n\n## References\n\n1. First <!-- id:keepMe12 -->\n',
    )
  })
})
