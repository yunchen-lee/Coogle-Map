# 批次生成鴿子留言

依照 `script/output/prompts.jsonl` 逐格生成鴿子留言，結果寫入 `script/output/comments.jsonl`。

語氣、長度、鴿子口吻等寫作規則以 skill 為準，本文件只規定輸入、輸出、流程與檢查。

所有路徑都相對於專案根目錄 `2026_1023_p5_pigeonMap/`。

## 輸入

`script/output/prompts.jsonl`：共 989 行，每行一格（一個地點）：

```json
{"id": "c4_-2", "n": 20, "prompt": "請只根據下面提供的資料寫……"}
```

- `id`：格子編號
- `n`：這格要寫幾則留言
- `prompt`：這格的地點資料與回傳格式，直接交給模型

查 fid 是否存在時，可以讀 `script/output/cells.json`：它是陣列，每個元素的 `id` 對應格子編號，`features[].fid` 是這格可以引用的所有 fid。

## 輸出

`script/output/comments.jsonl`：一行一格，格式：

```json
{"id": "c4_-2", "comments": [{"text": "...", "persona": "...", "uses": ["c4_-2-0"]}], "model": "模型名稱", "prompt_version": "v1"}
```

- `id`：照抄輸入的 `id`
- `comments`：模型回傳的 `comments` 陣列，原樣放入
- `model`：實際使用的模型名稱
- `prompt_version`：skill 的版本代號；skill 規則有改動時就換一個新代號

每行必須是單行的合法 JSON，不可換行、不可有尾逗號，以 UTF-8 儲存。

## 流程

1. 讀取現有的 `comments.jsonl`（不存在就視為空的），收集所有已完成的 `id`。
2. 逐行讀 `prompts.jsonl`。`id` 已完成的跳過。
3. 把 `prompt` 交給模型生成，並套用 skill 的寫作規則。
4. 依照下方「檢查」驗證回傳結果。
5. 通過檢查：在 `comments.jsonl` 檔尾追加一行，立刻寫入磁碟。
6. 未通過：同一格最多重試 2 次。仍失敗就寫入 `script/output/comments_errors.jsonl`，然後繼續下一格：
   ```json
   {"id": "c4_-2", "reason": "comment count 18, expected 20", "raw": "模型原始回傳"}
   ```
7. 全部跑完後，回報：完成格數、失敗格數、總留言數。

中斷後重新執行，會從尚未完成的格子接著跑。不要刪除或覆寫 `comments.jsonl` 裡已經寫入的行。

## 檢查

每格寫入前都要通過以下檢查：

- 回傳內容可以解析成 JSON，而且有 `comments` 陣列
- `comments` 的數量剛好等於 `n`
- 每則都有 `text`、`persona`、`uses` 三個欄位；`text` 和 `persona` 是非空字串，`uses` 是陣列（可以是空陣列）
- `uses` 裡的每個 fid 都屬於這一格，也就是在 `cells.json` 同一個 `id` 的 `features` 裡找得到
- `text` 不含門牌地址，例如「數字 + Street / Avenue / St / Ave」這種寫法
- `text` 不提到資料裡沒有的店名或地名

## 不要做的事

- 不要修改 `prompts.jsonl`、`cells.json` 或專案裡的其他檔案
- 不要合併、刪除或改寫已完成的行
- 不要用 skill 以外的規則改寫模型的留言內容；不合格就重試或記錄錯誤

## 參考數字

- 格子數：989
- 總留言數：3,630
- 每格留言數：1～20 則
