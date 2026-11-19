# 兄弟の関係年表（bruder.html）データ

画面のコード（`js/bruder.js`）は変更せず、このフォルダのJSONを編集するだけで出来事・史料を追加できます。
ページ下部の「データ検証」欄に、未登録IDの参照や日付の誤りが警告として表示されます。

| ファイル | 内容 |
|---|---|
| `people.json` | 人物（年表の線）。`order` の小さい順に上から並ぶ |
| `taxonomy.json` | 出来事の分類・史料の種別・情勢レイヤーの定義（色もここ）、初期表示位置 |
| `events.json` | 兄弟間の出来事。人物・分類・史料・情勢をIDで関連付ける |
| `sources.json` | 史料。複数の出来事から同じIDで参照できる |
| `context.json` | 政治・軍事情勢（別レイヤー） |

## 日付

```json
{ "year": 1757 }                       // 年のみ
{ "year": 1757, "month": 7 }           // 年月
{ "year": 1757, "month": 7, "day": 6 } // 年月日
{ "year": 1757, "circa": true }        // 「頃」を付けて表示
{}                                     // 年代不明（年表には置かず、一覧のみ）
```

わからない部分は書かないでください（推測で埋めない）。期間のある出来事は `dateEnd` を追加します。

## 出来事（events.json）

```json
{
  "id": "e-1757-xxx",                 // 一意のID（半角英数字・ハイフン）
  "date": { "year": 1757, "month": 7 },
  "title": "一覧・詳細に出るタイトル",
  "shortTitle": "年表上の短いラベル（省略可）",
  "people": ["friedrich-ii", "august-wilhelm"],
  "categories": ["conflict", "letter"],  // 複数可。taxonomy.json の eventCategories の id
  "summary": "簡潔な説明",
  "place": "場所（判明している場合のみ・省略可）",
  "sources": [ { "id": "s-xxx", "locator": "この出来事で参照した巻・頁", "note": "" } ],
  "facts": [ { "text": "史料から確認できる事実", "sources": ["s-xxx"] } ],
  "interpretations": [ { "text": "史料からの解釈", "by": "解釈した人・文献", "sources": ["s-yyy"] } ],
  "notes": "補足",
  "contextIds": ["ctx-seven-years"]
}
```

### 出来事の追加フィールド（すべて省略可）

```json
{
  "recordedDate": { "year": 1758, "month": 7 },   // 書簡・日記の記述日が出来事の発生日と異なる場合
  "dateNote": "日付は日記の記述日からの推定ではなく、本文中の「先週」による",  // 日付の精度・根拠の説明
  "needsCheck": "出典の巻数が未確定",              // true または理由の文字列 →「要確認」表示
  "relatedPeople": [
    "wilhelmine",                                   // people.json の lane:false 人物（年齢を自動表示）
    { "name": "ヴォルテール", "role": "書簡の言及" }, // 一度きりの人物は名前だけでも可
    { "name": "プロイセン王子妃", "identity": "ルイーゼ・アマーリエ" } // identity は内部識別名（画面には表示しない）
  ],
  "facts": [
    { "text": "要約", "quote": "原文がある場合のみ直接引用", "sources": ["s-xxx"] }
  ],
  "discrepancies": [
    { "text": "史料Aは7月、史料Bは8月とする", "sources": ["s-a", "s-b"] }
  ]
}
```

- `people` には兄弟（年表の線を持つ人物）のみを入れ、それ以外は `relatedPeople` に入れます。
- `sources[]` のリンクにも `"date"`（その箇所の記述日）と `"needsCheck": true` を付けられます。
- 日記・回想録の第三者評は `facts` に「〇〇は日記に〜と記している」の形で、筆者の証言として書きます。
- 新しい史料が既存の記述と食い違う場合は、既存の記述を消さずに `discrepancies` に記録します。

## 史料（sources.json）

`id, type, author, recipient, place, title, date, publication, volume, pages, url, quote, summary, note, needsCheck` を記入できます（空欄は表示されません）。
`place` は書簡の差出地、`publication` は書簡集など収録文献の書誌情報です（書簡集の個々の書簡を別々の史料として登録する場合に使います）。
`type` は `taxonomy.json` の `sourceTypes` の id です。`quote` は原文が提供された場合のみ記入し、それ以外は `summary` に要約を書きます。
出典が未確定の場合は `"needsCheck": true` を付け、`note` に未確定の内容を書きます。

## 年齢の自動表示

出来事の詳細欄では、関係人物の名前の横に、その時点の満年齢を自動表示します（出来事データへの登録は不要）。
`people.json` の `birth`（必要なら `death`）を、上記の日付形式で書くだけで、追加した人物にも自動で対応します。

- 生年月日と出来事の日付がどちらも年月日まで確定 → `45歳`
- どちらかが年月のみ・年のみで確定できない → `44〜45歳`（確定できる場合は幅なし）
- 「頃」（`circa`）を含む → `約45歳`
- 生年不明 → `年齢不明`、没後の出来事 → `没後`、誕生前 → `誕生前`
- 出来事の日付の幅が没年をまたぐ場合は、没時までの年齢で計算します

## 拡張

- **姉妹などの追加**：`people.json` に人物を追加（`group: "sister"` など）。`defaultVisible: false` にすると初期状態では非表示。
- **関連人物（線なし）**：`people.json` に `"lane": false` を付けて登録すると、年表の線・人物フィルタには出ず、出来事の `relatedPeople` から参照できます（`birth` があれば年齢も自動表示）。
- **分類の変更・追加**：`taxonomy.json` の `eventCategories` に追加。id は半角英小文字・数字・ハイフン。
- **所在地・活動**：`people[].residences` を将来用に予約しています（例：`{ "place": "ラインスベルク", "start": {...}, "end": {...}, "sources": [...] }`）。表示は未実装です。
- **デモデータ**：`"demo": true` の項目には「デモ」表示が付きます（現在デモの出来事・史料はすべて削除済み）。

出来事を登録するときのルールは `REGISTRATION_RULES.md` を参照してください。
