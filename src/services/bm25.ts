/**
 * Pure-TS BM25 encoder for sparse vectors compatible with Qdrant's
 * `modifier: "idf"` sparse vector configuration.
 *
 * Tokenizer: lowercase + split on \W+, with a special case for hex
 * bytes ($XX, $XXXX) and mnemonic-style identifiers (uppercase letters
 * with optional digits) which are preserved as single tokens.
 *
 * Math: standard BM25 (Robertson et al.), k1=1.2, b=0.75. IDF is
 * computed from corpus document frequency.
 *
 * Persistence: toJSON / fromJSON for vocab + DF + avgDocLen.
 */

export interface SparseVector {
  indices: number[];
  values: number[];
}

const HEX_TOKEN = /\$[0-9A-Fa-f]{2,4}/g;
const IDENT_TOKEN = /[A-Z][A-Z0-9_]+/g; // SCROLY, CHROUT, LDA, etc.
const WORD_TOKEN = /[a-zA-Z0-9_]+/g;

function tokenize(s: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<number>(); // byte offset of consumed regions
  const consume = (regex: RegExp, transform: (m: string) => string) => {
    let m: RegExpExecArray | null;
    regex.lastIndex = 0;
    while ((m = regex.exec(s)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      let overlap = false;
      for (let i = start; i < end; i++)
        if (seen.has(i)) {
          overlap = true;
          break;
        }
      if (overlap) continue;
      for (let i = start; i < end; i++) seen.add(i);
      tokens.push(transform(m[0]));
    }
  };
  // Order matters: hex first (keeps $A9 intact), then mnemonics (CHROUT),
  // then generic words.
  consume(HEX_TOKEN, (m) => m.toLowerCase());
  consume(IDENT_TOKEN, (m) => m.toLowerCase());
  consume(WORD_TOKEN, (m) => m.toLowerCase());
  return tokens;
}

export class BM25Encoder {
  private vocab = new Map<string, number>();
  private df = new Map<number, number>(); // token-id → document frequency
  private avgDocLen = 0;
  private numDocs = 0;
  private k1 = 1.2;
  private b = 0.75;

  fit(corpus: string[]): void {
    let totalLen = 0;
    for (const doc of corpus) {
      const tokens = tokenize(doc);
      const docTokenIds = new Set<number>();
      for (const tok of tokens) {
        let id = this.vocab.get(tok);
        if (id === undefined) {
          id = this.vocab.size;
          this.vocab.set(tok, id);
        }
        docTokenIds.add(id);
      }
      for (const id of docTokenIds) {
        this.df.set(id, (this.df.get(id) ?? 0) + 1);
      }
      totalLen += tokens.length;
      this.numDocs += 1;
    }
    this.avgDocLen = this.numDocs > 0 ? totalLen / this.numDocs : 0;
  }

  encode(text: string): SparseVector {
    const tokens = tokenize(text);
    if (tokens.length === 0) return { indices: [], values: [] };
    const tf = new Map<number, number>();
    for (const tok of tokens) {
      const id = this.vocab.get(tok);
      if (id === undefined) continue;
      tf.set(id, (tf.get(id) ?? 0) + 1);
    }
    const docLen = tokens.length;
    const out: SparseVector = { indices: [], values: [] };
    const sorted = Array.from(tf.entries()).sort(([a], [b]) => a - b);
    for (const [id, freq] of sorted) {
      const dfCount = this.df.get(id) ?? 0;
      if (dfCount === 0) continue;
      // BM25 score component for this term
      const idf = Math.log(1 + (this.numDocs - dfCount + 0.5) / (dfCount + 0.5));
      const norm =
        (freq * (this.k1 + 1)) / (freq + this.k1 * (1 - this.b + (this.b * docLen) / this.avgDocLen));
      const score = idf * norm;
      if (score > 0) {
        out.indices.push(id);
        out.values.push(score);
      }
    }
    return out;
  }

  toJSON(): {
    vocab: [string, number][];
    df: [number, number][];
    avgDocLen: number;
    numDocs: number;
    k1: number;
    b: number;
  } {
    return {
      vocab: Array.from(this.vocab.entries()),
      df: Array.from(this.df.entries()),
      avgDocLen: this.avgDocLen,
      numDocs: this.numDocs,
      k1: this.k1,
      b: this.b,
    };
  }

  static fromJSON(data: ReturnType<BM25Encoder["toJSON"]>): BM25Encoder {
    const enc = new BM25Encoder();
    enc.vocab = new Map(data.vocab);
    enc.df = new Map(data.df);
    enc.avgDocLen = data.avgDocLen;
    enc.numDocs = data.numDocs;
    enc.k1 = data.k1;
    enc.b = data.b;
    return enc;
  }
}
