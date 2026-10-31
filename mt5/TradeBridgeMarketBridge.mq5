//+------------------------------------------------------------------+
//| TradeBridgeMarketBridge.mq5  — Phase 1 + Phase 2                |
//| Phase 1: market selection commands + buy/sell market orders.     |
//| Phase 2: pending orders (limit/stop), position close/modify.     |
//+------------------------------------------------------------------+
#property strict
#property version   "3.00"
#property description "TradeBridge MT5 bridge — market selection, Phase 1 market orders, Phase 2 pending orders and position commands."

#include <Trade\Trade.mqh>

//── EA inputs ──────────────────────────────────────────────────────────────
input string InpBackendBaseUrl     = "https://ai-tradingbridge.vercel.app";
input string InpDeviceCredential   = "WLSuWYoG3Y_9Kwfh4D-UBvIqPHfMQwHsZs1ijL5sUgDMnUONnZG3RaBIF-WZ92OF";      // Paste the one-time credential from /mt5/pair
input string InpSymbolMappings     = "frxEURUSD=EURUSD";      // e.g. "frxEURUSD=EURUSD;frxGBPUSD=GBPUSD"
input int    InpPollSeconds        = 3;
input int    InpHttpTimeoutMs      = 8000;
// Safety: set this to "real" only when you are ready to trade a live account.
// The backend order queue is also stamped; mismatches are rejected by the EA.
input string InpAccountType        = "demo";  // "demo" or "real"

//── Globals ────────────────────────────────────────────────────────────────
string   g_base_url;
bool     g_poll_command_in_progress       = false;
bool     g_poll_order_in_progress         = false;
bool     g_poll_position_in_progress      = false;
CTrade   g_trade;

//── Phase 2: placed pending orders tracking ────────────────────────────────
struct PlacedOrder {
   string order_id;
   string lease_token;
   long   mt5_ticket;
   string broker_symbol;
};
PlacedOrder g_placed_orders[];

void AddPlacedOrder(const string order_id, const string lease_token,
                    const long ticket, const string broker_symbol)
{
   int n = ArraySize(g_placed_orders);
   ArrayResize(g_placed_orders, n + 1);
   g_placed_orders[n].order_id      = order_id;
   g_placed_orders[n].lease_token   = lease_token;
   g_placed_orders[n].mt5_ticket    = ticket;
   g_placed_orders[n].broker_symbol = broker_symbol;
}

void RemovePlacedOrder(const long ticket)
{
   int count = ArraySize(g_placed_orders);
   for(int i = 0; i < count; i++)
   {
      if(g_placed_orders[i].mt5_ticket == ticket)
      {
         // Shift remaining entries down
         for(int j = i; j < count - 1; j++)
            g_placed_orders[j] = g_placed_orders[j + 1];
         ArrayResize(g_placed_orders, count - 1);
         return;
      }
   }
}

//──────────────────────────────────────────────────────────────────────────
// Utility: bytes ↔ string
//──────────────────────────────────────────────────────────────────────────
void StringToUtf8Bytes(const string value, char &bytes[])
{
   int count = StringToCharArray(value, bytes, 0, WHOLE_ARRAY, CP_UTF8);
   if(count > 0) ArrayResize(bytes, count - 1);
}
string Utf8BytesToString(char &bytes[])
{
   return CharArrayToString(bytes, 0, WHOLE_ARRAY, CP_UTF8);
}

//──────────────────────────────────────────────────────────────────────────
// Utility: minimal JSON escaping for string values
//──────────────────────────────────────────────────────────────────────────
string JsonEscape(const string value)
{
   string out = "";
   int len = StringLen(value);
   for(int i = 0; i < len; i++)
   {
      ushort c = StringGetCharacter(value, i);
      if(c == 34)      out += "\\\"";
      else if(c == 92) out += "\\\\";
      else if(c == 10) out += "\\n";
      else if(c == 13) out += "\\r";
      else if(c == 9)  out += "\\t";
      else             out += ShortToString(c);
   }
   return out;
}

//──────────────────────────────────────────────────────────────────────────
// Utility: extract a JSON string field value (handles \" and \\ escapes)
//──────────────────────────────────────────────────────────────────────────
string JsonStringField(const string json, const string field)
{
   string needle = "\"" + field + "\"";
   int key_pos = StringFind(json, needle);
   if(key_pos < 0) return "";
   int colon_pos = StringFind(json, ":", key_pos + StringLen(needle));
   if(colon_pos < 0) return "";
   // Skip whitespace after colon
   int quote_pos = -1;
   for(int i = colon_pos + 1; i < StringLen(json); i++)
   {
      ushort c = StringGetCharacter(json, i);
      if(c == '"') { quote_pos = i; break; }
      if(c != ' ' && c != '\t' && c != '\n' && c != '\r') break; // not a string value
   }
   if(quote_pos < 0) return "";
   string value = "";
   bool escaped = false;
   for(int i = quote_pos + 1; i < StringLen(json); i++)
   {
      ushort c = StringGetCharacter(json, i);
      if(escaped)
      {
         if(c == 'n')      value += "\n";
         else if(c == 'r') value += "\r";
         else if(c == 't') value += "\t";
         else              value += ShortToString(c);
         escaped = false;
         continue;
      }
      if(c == 92) { escaped = true; continue; }
      if(c == 34) return value;
      value += ShortToString(c);
   }
   return "";
}

//──────────────────────────────────────────────────────────────────────────
// Utility: extract a JSON numeric field as a double; returns -1 on missing
//──────────────────────────────────────────────────────────────────────────
double JsonNumberField(const string json, const string field)
{
   string needle = "\"" + field + "\"";
   int key_pos = StringFind(json, needle);
   if(key_pos < 0) return -1.0;
   int colon_pos = StringFind(json, ":", key_pos + StringLen(needle));
   if(colon_pos < 0) return -1.0;
   string numStr = "";
   bool started = false;
   for(int i = colon_pos + 1; i < StringLen(json); i++)
   {
      ushort c = StringGetCharacter(json, i);
      if(!started && (c == ' ' || c == '\t' || c == '\n' || c == '\r')) continue;
      if(c == 'n' && !started) return -1.0; // null
      if((c >= '0' && c <= '9') || c == '.' || c == '-' || c == 'e' || c == 'E' || c == '+')
      {
         numStr += ShortToString(c);
         started = true;
      }
      else if(started) break;
   }
   if(numStr == "") return -1.0;
   return StringToDouble(numStr);
}

//──────────────────────────────────────────────────────────────────────────
// HTTP helper — all EA→backend calls
//──────────────────────────────────────────────────────────────────────────
bool HttpRequest(const string method, const string path, const string body,
                 string &response_text, int &http_status)
{
   char req_bytes[], resp_bytes[];
   string resp_headers = "";
   string headers = "Authorization: Bearer " + InpDeviceCredential + "\r\n"
                  + "Content-Type: application/json\r\n"
                  + "Accept: application/json\r\n";
   StringToUtf8Bytes(body, req_bytes);
   ResetLastError();
   http_status = WebRequest(method, g_base_url + path, headers,
                            InpHttpTimeoutMs, req_bytes, resp_bytes, resp_headers);
   if(http_status == -1)
   {
      int err = GetLastError();
      Print("TradeBridge HTTP error. MQL5 error=", err,
            " for ", method, " ", path,
            ". Check WebRequest allow-list.");
      response_text = "";
      return false;
   }
   response_text = Utf8BytesToString(resp_bytes);
   if(http_status < 200 || http_status >= 300)
   {
      Print("TradeBridge HTTP ", http_status, " for ", method, " ", path,
            ". Response: ", response_text);
      return false;
   }
   return true;
}

//──────────────────────────────────────────────────────────────────────────
// Symbol mapping: provider symbol → broker symbol
//──────────────────────────────────────────────────────────────────────────
bool ResolveBrokerSymbol(const string provider_symbol, string &broker_symbol)
{
   string mappings[];
   int count = StringSplit(InpSymbolMappings, ';', mappings);
   for(int i = 0; i < count; i++)
   {
      string pair = mappings[i];
      StringTrimLeft(pair);
      StringTrimRight(pair);
      int eq = StringFind(pair, "=");
      if(eq <= 0) continue;
      string prov   = StringSubstr(pair, 0, eq);
      string broker = StringSubstr(pair, eq + 1);
      StringTrimLeft(prov);  StringTrimRight(prov);
      StringTrimLeft(broker); StringTrimRight(broker);
      if(prov == provider_symbol && broker != "")
      { broker_symbol = broker; return true; }
   }
   return false;
}

//──────────────────────────────────────────────────────────────────────────
// MARKET-SELECTION command handler (unchanged from v1.00)
//──────────────────────────────────────────────────────────────────────────
bool SelectBrokerMarket(const string broker_symbol, string &result_code, string &result_message)
{
   if(broker_symbol == "")
   {
      result_code = "SYMBOL_MAPPING_MISSING";
      result_message = "No mapping configured.";
      return false;
   }
   bool is_custom = false;
   if(!SymbolExist(broker_symbol, is_custom))
   {
      result_code = "BROKER_SYMBOL_NOT_FOUND";
      result_message = "Symbol not found in terminal: " + broker_symbol;
      return false;
   }
   ResetLastError();
   if(!SymbolSelect(broker_symbol, true))
   {
      result_code = "SYMBOL_SELECT_FAILED";
      result_message = "SymbolSelect failed for " + broker_symbol
                     + "; error=" + IntegerToString(GetLastError());
      return false;
   }
   result_code    = "MARKET_SELECTED";
   result_message = "Selected " + broker_symbol;
   Print("TradeBridge market selected: ", broker_symbol);
   return true;
}

bool AcknowledgeCommand(const string command_id, const string lease_token,
                        const bool accepted, const string result_code,
                        const string result_message)
{
   string outcome = accepted ? "acknowledged" : "rejected";
   string body    = "{\"lease_token\":\"" + JsonEscape(lease_token)
                  + "\",\"outcome\":\"" + outcome
                  + "\",\"result_code\":\"" + JsonEscape(result_code)
                  + "\",\"result_message\":\"" + JsonEscape(result_message) + "\"}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/commands/" + command_id + "/ack", body, resp, status))
   {
      Print("Could not ack market command ", command_id,
            ". Will retry after lease expires.");
      return false;
   }
   Print("Market command ", command_id, " acknowledged as ", outcome, " (", result_code, ").");
   return true;
}

void PollForCommand()
{
   if(g_poll_command_in_progress) return;
   g_poll_command_in_progress = true;
   string resp; int status;
   if(!HttpRequest("GET", "/mt5/ea/commands/next?lease_seconds=20", "", resp, status))
   { g_poll_command_in_progress = false; return; }

   string command_id = JsonStringField(resp, "id");
   if(command_id == "") { g_poll_command_in_progress = false; return; }

   string provider_symbol = JsonStringField(resp, "provider_symbol");
   string lease_token     = JsonStringField(resp, "lease_token");
   if(provider_symbol == "" || lease_token == "")
   {
      Print("Malformed market command response.");
      g_poll_command_in_progress = false;
      return;
   }

   string broker_symbol = "", result_code = "", result_message = "";
   bool mapped   = ResolveBrokerSymbol(provider_symbol, broker_symbol);
   bool selected = false;
   if(!mapped) { result_code = "SYMBOL_MAPPING_MISSING"; result_message = "No mapping for " + provider_symbol; }
   else selected = SelectBrokerMarket(broker_symbol, result_code, result_message);

   AcknowledgeCommand(command_id, lease_token, selected, result_code, result_message);
   g_poll_command_in_progress = false;
}

//──────────────────────────────────────────────────────────────────────────
// TRADE ORDER helpers
//──────────────────────────────────────────────────────────────────────────

// Ack: leased → submitted
void AckSubmitted(const string order_id, const string lease_token,
                  const long ticket, const int retcode, const string retcode_desc)
{
   string ticketStr = (ticket > 0) ? IntegerToString(ticket) : "null";
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token) + "\""
               + (ticket > 0 ? (",\"mt5_order_ticket\":" + ticketStr) : "")
               + ",\"mt5_retcode\":" + IntegerToString(retcode)
               + ",\"mt5_retcode_description\":\"" + JsonEscape(retcode_desc) + "\"}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/trade-orders/" + order_id + "/ack/submitted", body, resp, status))
      Print("Could not ack submitted for order ", order_id);
}

// Ack: submitted → accepted
void AckAccepted(const string order_id, const string lease_token,
                 const long ticket, const int retcode, const string retcode_desc)
{
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token)
               + "\",\"mt5_order_ticket\":" + IntegerToString(ticket)
               + ",\"mt5_retcode\":" + IntegerToString(retcode)
               + ",\"mt5_retcode_description\":\"" + JsonEscape(retcode_desc) + "\"}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/trade-orders/" + order_id + "/ack/accepted", body, resp, status))
      Print("Could not ack accepted for order ", order_id);
}

// Ack: submitted → placed (Phase 2: pending order placed in broker book)
void AckPlaced(const string order_id, const string lease_token,
               const long ticket, const int retcode, const string retcode_desc)
{
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token)
               + "\",\"mt5_order_ticket\":" + IntegerToString(ticket)
               + ",\"mt5_retcode\":" + IntegerToString(retcode)
               + ",\"mt5_retcode_description\":\"" + JsonEscape(retcode_desc) + "\"}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/trade-orders/" + order_id + "/ack/placed", body, resp, status))
      Print("Could not ack placed for order ", order_id);
}

// Ack: leased|submitted → rejected
void AckRejected(const string order_id, const string lease_token,
                 const long ticket, const int retcode, const string retcode_desc,
                 const string reject_reason)
{
   string ticketPart = (ticket > 0) ? (",\"mt5_order_ticket\":" + IntegerToString(ticket)) : "";
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token) + "\""
               + ticketPart
               + ",\"mt5_retcode\":" + IntegerToString(retcode)
               + ",\"mt5_retcode_description\":\"" + JsonEscape(retcode_desc)
               + "\",\"reject_reason\":\"" + JsonEscape(reject_reason) + "\"}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/trade-orders/" + order_id + "/ack/rejected", body, resp, status))
      Print("Could not ack rejected for order ", order_id);
}

// Ack: placed → cancelled-pending (Phase 2: pending order cancelled before fill)
void AckCancelledPending(const string order_id, const string lease_token,
                         const string reject_reason)
{
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token)
               + (reject_reason != "" ? (",\"reject_reason\":\"" + JsonEscape(reject_reason) + "\"") : "")
               + "}";
   string resp; int st;
   if(!HttpRequest("POST", "/mt5/ea/trade-orders/" + order_id + "/ack/cancelled-pending", body, resp, st))
      Print("Could not ack cancelled-pending for order ", order_id);
}

// Ack: accepted → filled
void AckFilled(const string order_id, const string lease_token,
               const long order_ticket, const long deal_ticket,
               const double fill_price, const double fill_volume,
               const int retcode, const string retcode_desc)
{
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token) + "\""
               + (order_ticket > 0 ? (",\"mt5_order_ticket\":" + IntegerToString(order_ticket)) : "")
               + (deal_ticket  > 0 ? (",\"mt5_deal_ticket\":"  + IntegerToString(deal_ticket))  : "")
               + ",\"fill_price\":" + DoubleToString(fill_price, 8)
               + ",\"fill_volume\":" + DoubleToString(fill_volume, 8)
               + ",\"mt5_retcode\":" + IntegerToString(retcode)
               + ",\"mt5_retcode_description\":\"" + JsonEscape(retcode_desc) + "\"}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/trade-orders/" + order_id + "/ack/filled", body, resp, status))
      Print("Could not ack filled for order ", order_id);
}

// Ack: accepted|submitted → reconciled  (used after timeout recovery)
void AckReconciled(const string order_id, const string lease_token,
                   const long order_ticket, const long deal_ticket,
                   const double fill_price, const double fill_volume,
                   const string reject_reason)
{
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token) + "\""
               + (order_ticket > 0 ? (",\"mt5_order_ticket\":" + IntegerToString(order_ticket)) : "")
               + (deal_ticket  > 0 ? (",\"mt5_deal_ticket\":"  + IntegerToString(deal_ticket))  : "")
               + (fill_price   > 0 ? (",\"fill_price\":"       + DoubleToString(fill_price, 8)) : "")
               + (fill_volume  > 0 ? (",\"fill_volume\":"      + DoubleToString(fill_volume, 8)): "")
               + (reject_reason != "" ? (",\"reject_reason\":\"" + JsonEscape(reject_reason) + "\"") : "")
               + "}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/trade-orders/" + order_id + "/ack/reconciled", body, resp, status))
      Print("Could not ack reconciled for order ", order_id);
}

//──────────────────────────────────────────────────────────────────────────
// POSITION COMMAND ack helpers (Phase 2)
//──────────────────────────────────────────────────────────────────────────

void AckPositionSubmitted(const string cmd_id, const string lease_token,
                          const int retcode, const string retcode_desc)
{
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token)
               + "\",\"mt5_retcode\":" + IntegerToString(retcode)
               + ",\"mt5_retcode_description\":\"" + JsonEscape(retcode_desc) + "\"}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/position-commands/" + cmd_id + "/ack/submitted", body, resp, status))
      Print("Could not ack position-submitted for cmd ", cmd_id);
}

void AckPositionDone(const string cmd_id, const string lease_token,
                     const int retcode, const string retcode_desc)
{
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token)
               + "\",\"mt5_retcode\":" + IntegerToString(retcode)
               + ",\"mt5_retcode_description\":\"" + JsonEscape(retcode_desc) + "\"}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/position-commands/" + cmd_id + "/ack/done", body, resp, status))
      Print("Could not ack position-done for cmd ", cmd_id);
}

void AckPositionRejected(const string cmd_id, const string lease_token,
                         const int retcode, const string retcode_desc,
                         const string reject_reason)
{
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token)
               + "\",\"mt5_retcode\":" + IntegerToString(retcode)
               + ",\"mt5_retcode_description\":\"" + JsonEscape(retcode_desc)
               + "\",\"reject_reason\":\"" + JsonEscape(reject_reason) + "\"}";
   string resp; int status;
   if(!HttpRequest("POST", "/mt5/ea/position-commands/" + cmd_id + "/ack/rejected", body, resp, status))
      Print("Could not ack position-rejected for cmd ", cmd_id);
}

//──────────────────────────────────────────────────────────────────────────
// Reconcile an order that was submitted but whose fill outcome is uncertain.
// Searches open positions and recent history for the order_ticket.
//──────────────────────────────────────────────────────────────────────────
void ReconcileSubmittedOrder(const string order_id, const string lease_token,
                             const long order_ticket, const string broker_symbol)
{
   Print("TradeBridge reconciling order_id=", order_id,
         " ticket=", order_ticket, " symbol=", broker_symbol);

   // 1. Check open positions first
   for(int i = 0; i < PositionsTotal(); i++)
   {
      if(PositionGetTicket(i) == 0) continue;
      if(PositionGetInteger(POSITION_IDENTIFIER) == order_ticket ||
         PositionGetString(POSITION_SYMBOL) == broker_symbol)
      {
         long deal = PositionGetInteger(POSITION_IDENTIFIER);
         double price = PositionGetDouble(POSITION_PRICE_OPEN);
         double vol   = PositionGetDouble(POSITION_VOLUME);
         Print("TradeBridge reconcile: found open position ticket=", deal,
               " price=", price, " volume=", vol);
         AckReconciled(order_id, lease_token, order_ticket, deal, price, vol, "");
         return;
      }
   }

   // 2. Search recent order history
   ulong hist_ticket = 0;
   if(HistoryOrderSelect(order_ticket))
   {
      int hist_state = (int)HistoryOrderGetInteger(order_ticket, ORDER_STATE);
      // ORDER_STATE_FILLED = 2
      if(hist_state == 2)
      {
         double price = HistoryOrderGetDouble(order_ticket, ORDER_PRICE_OPEN);
         double vol   = HistoryOrderGetDouble(order_ticket, ORDER_VOLUME_CURRENT);
         Print("TradeBridge reconcile: found filled history order ticket=", order_ticket);
         AckReconciled(order_id, lease_token, order_ticket, 0, price, vol, "");
         return;
      }
      // ORDER_STATE_CANCELED = 3, ORDER_STATE_REJECTED = 4
      if(hist_state == 3 || hist_state == 4)
      {
         string reason = "Order in history with state=" + IntegerToString(hist_state);
         Print("TradeBridge reconcile: order cancelled/rejected in history. State=", hist_state);
         AckReconciled(order_id, lease_token, order_ticket, 0, 0, 0, reason);
         return;
      }
   }

   // 3. Nothing found — report uncertainty to the backend as reconciled with reject reason
   string reason = "Reconciliation: no open position or history entry found for ticket "
                 + IntegerToString(order_ticket);
   Print("TradeBridge reconcile: ", reason);
   AckReconciled(order_id, lease_token, order_ticket, 0, 0, 0, reason);
}

//──────────────────────────────────────────────────────────────────────────
// Execute a trade order: the core Phase 1 logic (market orders)
//──────────────────────────────────────────────────────────────────────────
void ExecuteTradeOrder(const string order_id,
                       const string broker_symbol,
                       const string order_side,
                       const double volume,
                       const double stop_loss,
                       const double take_profit,
                       const int    deviation_points,
                       const int    magic_number,
                       const string account_type_str,
                       const string lease_token)
{
   // ── Safety: account type guard ────────────────────────────────────────
   // Compare the order's declared account_type against the real connected account.
   // ACCOUNT_TRADE_MODE_DEMO = 0, ACCOUNT_TRADE_MODE_REAL = 2
   long account_mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   bool is_demo_account = (account_mode == 0) || (account_mode == 1); // DEMO or CONTEST
   bool order_expects_demo = (account_type_str == "demo");

   if(order_expects_demo != is_demo_account)
   {
      string reason = "Account type mismatch: order expects " + account_type_str
                    + " but connected account mode=" + IntegerToString((int)account_mode);
      Print("TradeBridge SAFETY BLOCK — ", reason);
      AckRejected(order_id, lease_token, 0, 0, "ACCOUNT_TYPE_MISMATCH", reason);
      return;
   }

   // ── Validate symbol ───────────────────────────────────────────────────
   bool is_custom = false;
   if(!SymbolExist(broker_symbol, is_custom))
   {
      AckRejected(order_id, lease_token, 0, 0, "SYMBOL_NOT_FOUND",
                  "Symbol not found in terminal: " + broker_symbol);
      return;
   }
   if(!SymbolSelect(broker_symbol, true))
   {
      AckRejected(order_id, lease_token, 0, 0, "SYMBOL_SELECT_FAILED",
                  "SymbolSelect failed for " + broker_symbol
                  + "; error=" + IntegerToString(GetLastError()));
      return;
   }

   // ── Validate volume ───────────────────────────────────────────────────
   double min_lot  = SymbolInfoDouble(broker_symbol, SYMBOL_VOLUME_MIN);
   double max_lot  = SymbolInfoDouble(broker_symbol, SYMBOL_VOLUME_MAX);
   double lot_step = SymbolInfoDouble(broker_symbol, SYMBOL_VOLUME_STEP);
   if(volume < min_lot || volume > max_lot)
   {
      AckRejected(order_id, lease_token, 0, 0, "INVALID_VOLUME",
                  "Volume " + DoubleToString(volume, 4)
                  + " outside broker range [" + DoubleToString(min_lot, 4)
                  + ", " + DoubleToString(max_lot, 4) + "]");
      return;
   }
   // Snap volume to nearest valid lot step to avoid INVALID_VOLUME retcodes
   double snapped_volume = MathRound(volume / lot_step) * lot_step;

   // ── Configure CTrade ─────────────────────────────────────────────────
   g_trade.SetExpertMagicNumber(magic_number);
   if(deviation_points >= 0)
      g_trade.SetDeviationInPoints((ulong)deviation_points);
   else
      g_trade.SetDeviationInPoints(10); // sane default
   g_trade.SetTypeFilling(ORDER_FILLING_FOK); // Change to IOC if your broker requires it

   // ── Send order ────────────────────────────────────────────────────────
   bool sent = false;
   if(order_side == "buy")
      sent = g_trade.Buy(snapped_volume, broker_symbol,
                         0,          // market price (0 = broker fills at current ask)
                         stop_loss  > 0 ? stop_loss  : 0,
                         take_profit > 0 ? take_profit : 0,
                         "TradeBridge " + order_id);
   else if(order_side == "sell")
      sent = g_trade.Sell(snapped_volume, broker_symbol,
                          0,
                          stop_loss  > 0 ? stop_loss  : 0,
                          take_profit > 0 ? take_profit : 0,
                          "TradeBridge " + order_id);
   else
   {
      AckRejected(order_id, lease_token, 0, 0, "INVALID_ORDER_SIDE",
                  "order_side must be 'buy' or 'sell', got: " + order_side);
      return;
   }

   int     retcode      = (int)g_trade.ResultRetcode();
   string  retcode_desc = g_trade.ResultRetcodeDescription();
   ulong   order_ticket = g_trade.ResultOrder();
   ulong   deal_ticket  = g_trade.ResultDeal();
   double  fill_price   = g_trade.ResultPrice();
   double  fill_volume  = g_trade.ResultVolume();

   Print("TradeBridge OrderSend result: sent=", sent,
         " retcode=", retcode, " (", retcode_desc, ")",
         " order=", order_ticket, " deal=", deal_ticket,
         " price=", fill_price, " volume=", fill_volume);

   // ── Report leased → submitted (always, even on failure) ───────────────
   AckSubmitted(order_id, lease_token, (long)order_ticket, retcode, retcode_desc);

   if(!sent)
   {
      // OrderSend returned false → broker or terminal rejected before acceptance
      AckRejected(order_id, lease_token, (long)order_ticket, retcode, retcode_desc,
                  "OrderSend returned false: " + retcode_desc);
      return;
   }

   // TRADE_RETCODE_DONE = 10009  — order executed and filled immediately
   // TRADE_RETCODE_PLACED = 10008 — order accepted but fill may be async (rare for market)
   // TRADE_RETCODE_DONE_PARTIAL = 10010 — partially filled
   if(retcode == 10009 || retcode == 10010)
   {
      // Fully (or partially) filled in one round-trip
      AckAccepted(order_id, lease_token, (long)order_ticket, retcode, retcode_desc);
      AckFilled(order_id, lease_token, (long)order_ticket, (long)deal_ticket,
                fill_price, fill_volume, retcode, retcode_desc);
      return;
   }

   if(retcode == 10008)
   {
      // Order placed but fill not yet confirmed.
      // Report accepted; fill confirmation will be reconciled on the next poll cycle
      // if the backend order re-appears as 'accepted' in the next lease.
      AckAccepted(order_id, lease_token, (long)order_ticket, retcode, retcode_desc);
      // Attempt immediate reconciliation before returning
      Sleep(500); // brief wait for broker to process
      ReconcileSubmittedOrder(order_id, lease_token, (long)order_ticket, broker_symbol);
      return;
   }

   // Any other retcode from a "sent=true" result is unusual; reconcile defensively
   if(order_ticket > 0)
   {
      Print("TradeBridge: unexpected retcode=", retcode, " with sent=true. Reconciling.");
      AckAccepted(order_id, lease_token, (long)order_ticket, retcode, retcode_desc);
      ReconcileSubmittedOrder(order_id, lease_token, (long)order_ticket, broker_symbol);
   }
   else
   {
      AckRejected(order_id, lease_token, 0, retcode, retcode_desc,
                  "Unexpected result: sent=true but no ticket. retcode=" + IntegerToString(retcode));
   }
}

//──────────────────────────────────────────────────────────────────────────
// Execute a pending (limit/stop) order — Phase 2
//──────────────────────────────────────────────────────────────────────────
void ExecutePendingOrder(const string order_id,
                         const string broker_symbol,
                         const string order_side,
                         const string order_type_str,
                         const double volume,
                         const double entry_price,
                         const double stop_loss,
                         const double take_profit,
                         const int    deviation_points,
                         const int    magic_number,
                         const string account_type_str,
                         const string lease_token)
{
   // ── Safety: account type guard ────────────────────────────────────────
   long account_mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   bool is_demo_account = (account_mode == 0) || (account_mode == 1);
   bool order_expects_demo = (account_type_str == "demo");

   if(order_expects_demo != is_demo_account)
   {
      string reason = "Account type mismatch: order expects " + account_type_str
                    + " but connected account mode=" + IntegerToString((int)account_mode);
      Print("TradeBridge SAFETY BLOCK — ", reason);
      AckRejected(order_id, lease_token, 0, 0, "ACCOUNT_TYPE_MISMATCH", reason);
      return;
   }

   // ── Validate symbol ───────────────────────────────────────────────────
   bool is_custom = false;
   if(!SymbolExist(broker_symbol, is_custom))
   {
      AckRejected(order_id, lease_token, 0, 0, "SYMBOL_NOT_FOUND",
                  "Symbol not found in terminal: " + broker_symbol);
      return;
   }
   if(!SymbolSelect(broker_symbol, true))
   {
      AckRejected(order_id, lease_token, 0, 0, "SYMBOL_SELECT_FAILED",
                  "SymbolSelect failed for " + broker_symbol
                  + "; error=" + IntegerToString(GetLastError()));
      return;
   }

   // ── Validate entry price ──────────────────────────────────────────────
   if(entry_price <= 0)
   {
      AckRejected(order_id, lease_token, 0, 0, "INVALID_ENTRY_PRICE",
                  "entry_price must be > 0 for pending orders, got: "
                  + DoubleToString(entry_price, 8));
      return;
   }

   // ── Validate volume ───────────────────────────────────────────────────
   double min_lot  = SymbolInfoDouble(broker_symbol, SYMBOL_VOLUME_MIN);
   double max_lot  = SymbolInfoDouble(broker_symbol, SYMBOL_VOLUME_MAX);
   double lot_step = SymbolInfoDouble(broker_symbol, SYMBOL_VOLUME_STEP);
   if(volume < min_lot || volume > max_lot)
   {
      AckRejected(order_id, lease_token, 0, 0, "INVALID_VOLUME",
                  "Volume " + DoubleToString(volume, 4)
                  + " outside broker range [" + DoubleToString(min_lot, 4)
                  + ", " + DoubleToString(max_lot, 4) + "]");
      return;
   }
   double snapped_volume = MathRound(volume / lot_step) * lot_step;

   // ── Map order_type_str to ENUM_ORDER_TYPE ─────────────────────────────
   ENUM_ORDER_TYPE order_type_enum;
   if(order_type_str == "buy_limit")
      order_type_enum = ORDER_TYPE_BUY_LIMIT;
   else if(order_type_str == "sell_limit")
      order_type_enum = ORDER_TYPE_SELL_LIMIT;
   else if(order_type_str == "buy_stop")
      order_type_enum = ORDER_TYPE_BUY_STOP;
   else if(order_type_str == "sell_stop")
      order_type_enum = ORDER_TYPE_SELL_STOP;
   else
   {
      AckRejected(order_id, lease_token, 0, 0, "INVALID_ORDER_TYPE",
                  "Unknown order_type: " + order_type_str
                  + ". Expected: buy_limit, sell_limit, buy_stop, sell_stop");
      return;
   }

   // ── Configure CTrade ─────────────────────────────────────────────────
   g_trade.SetExpertMagicNumber(magic_number);
   if(deviation_points >= 0)
      g_trade.SetDeviationInPoints((ulong)deviation_points);
   else
      g_trade.SetDeviationInPoints(10);
   g_trade.SetTypeFilling(ORDER_FILLING_FOK);

   // ── Place pending order ───────────────────────────────────────────────
   bool sent = g_trade.OrderOpen(broker_symbol, order_type_enum, snapped_volume,
                                 0,            // stoplimit price (0 = unused)
                                 entry_price,
                                 stop_loss   > 0 ? stop_loss   : 0,
                                 take_profit > 0 ? take_profit : 0,
                                 ORDER_TIME_GTC,
                                 0,
                                 "TradeBridge " + order_id);

   int    retcode      = (int)g_trade.ResultRetcode();
   string retcode_desc = g_trade.ResultRetcodeDescription();
   ulong  order_ticket = g_trade.ResultOrder();

   Print("TradeBridge PendingOrder result: sent=", sent,
         " type=", order_type_str,
         " retcode=", retcode, " (", retcode_desc, ")",
         " order=", order_ticket);

   // ── Always ack submitted ──────────────────────────────────────────────
   AckSubmitted(order_id, lease_token, (long)order_ticket, retcode, retcode_desc);

   // ── Check success ─────────────────────────────────────────────────────
   // TRADE_RETCODE_PLACED = 10008 — pending order accepted by broker
   // TRADE_RETCODE_DONE  = 10009 — accepted (some brokers return this)
   if(!sent || (retcode != 10008 && retcode != 10009))
   {
      AckRejected(order_id, lease_token, (long)order_ticket, retcode, retcode_desc,
                  "OrderOpen failed: " + retcode_desc);
      return;
   }

   // ── Pending order placed — track for async fill detection ─────────────
   AckPlaced(order_id, lease_token, (long)order_ticket, retcode, retcode_desc);
   AddPlacedOrder(order_id, lease_token, (long)order_ticket, broker_symbol);
}

//──────────────────────────────────────────────────────────────────────────
// Poll the backend for the next pending trade order
//──────────────────────────────────────────────────────────────────────────
void PollForTradeOrder()
{
   if(g_poll_order_in_progress) return;
   g_poll_order_in_progress = true;

   string resp; int status;
   if(!HttpRequest("GET", "/mt5/ea/trade-orders/next?lease_seconds=30", "", resp, status))
   { g_poll_order_in_progress = false; return; }

   string order_id = JsonStringField(resp, "id");
   if(order_id == "") { g_poll_order_in_progress = false; return; }

   string broker_symbol  = JsonStringField(resp, "broker_symbol");
   string order_side     = JsonStringField(resp, "order_side");
   string lease_token    = JsonStringField(resp, "lease_token");
   string account_type   = JsonStringField(resp, "account_type");
   string order_type     = JsonStringField(resp, "order_type");

   double volume          = JsonNumberField(resp, "volume");
   double stop_loss       = JsonNumberField(resp, "stop_loss");
   double take_profit     = JsonNumberField(resp, "take_profit");
   double deviation_d     = JsonNumberField(resp, "deviation_points");
   double magic_d         = JsonNumberField(resp, "magic_number");
   double entry_price     = JsonNumberField(resp, "entry_price");

   if(broker_symbol == "" || order_side == "" || lease_token == "" || volume <= 0)
   {
      Print("TradeBridge: malformed trade order response from server.");
      g_poll_order_in_progress = false;
      return;
   }

   // null JSON fields come back as -1 from JsonNumberField; map to 0
   if(stop_loss   < 0) stop_loss   = 0;
   if(take_profit < 0) take_profit = 0;
   if(entry_price < 0) entry_price = 0;
   int deviation_points = (deviation_d >= 0) ? (int)deviation_d : -1;
   int magic_number     = (magic_d    >= 0) ? (int)magic_d    : 0;

   Print("TradeBridge: executing trade order id=", order_id,
         " symbol=", broker_symbol, " side=", order_side, " type=", order_type,
         " volume=", volume, " sl=", stop_loss, " tp=", take_profit,
         " entry=", entry_price);

   // Route to market or pending execution
   if(order_type == "" || order_type == "market")
      ExecuteTradeOrder(order_id, broker_symbol, order_side, volume,
                        stop_loss, take_profit, deviation_points, magic_number,
                        account_type, lease_token);
   else
      ExecutePendingOrder(order_id, broker_symbol, order_side, order_type, volume,
                          entry_price, stop_loss, take_profit, deviation_points,
                          magic_number, account_type, lease_token);

   g_poll_order_in_progress = false;
}

//──────────────────────────────────────────────────────────────────────────
// Execute a position close or modify command — Phase 2
//──────────────────────────────────────────────────────────────────────────
void ExecutePositionCommand(const string cmd_id,
                            const string command_type,
                            const long   position_ticket,
                            const double volume,
                            const double new_sl,
                            const double new_tp,
                            const string account_type_str,
                            const string lease_token)
{
   // ── Safety: account type guard ────────────────────────────────────────
   long account_mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   bool is_demo_account = (account_mode == 0) || (account_mode == 1);
   bool order_expects_demo = (account_type_str == "demo");

   if(order_expects_demo != is_demo_account)
   {
      string reason = "Account type mismatch: command expects " + account_type_str
                    + " but connected account mode=" + IntegerToString((int)account_mode);
      Print("TradeBridge SAFETY BLOCK — ", reason);
      // Always ack submitted first, then reject
      AckPositionSubmitted(cmd_id, lease_token, 0, "ACCOUNT_TYPE_MISMATCH");
      AckPositionRejected(cmd_id, lease_token, 0, "ACCOUNT_TYPE_MISMATCH", reason);
      return;
   }

   // ── Always ack submitted ──────────────────────────────────────────────
   AckPositionSubmitted(cmd_id, lease_token, 0, "");

   bool sent = false;
   if(command_type == "close")
   {
      if(volume > 0)
         sent = g_trade.PositionClosePartial(position_ticket, volume);
      else
         sent = g_trade.PositionClose(position_ticket);
   }
   else if(command_type == "modify")
   {
      sent = g_trade.PositionModify(position_ticket, new_sl, new_tp);
   }
   else
   {
      string reason = "Unknown command_type: " + command_type;
      Print("TradeBridge: ", reason);
      AckPositionRejected(cmd_id, lease_token, 0, "UNKNOWN_COMMAND_TYPE", reason);
      return;
   }

   int    retcode      = (int)g_trade.ResultRetcode();
   string retcode_desc = g_trade.ResultRetcodeDescription();

   Print("TradeBridge PositionCommand result: cmd=", command_type,
         " ticket=", position_ticket, " sent=", sent,
         " retcode=", retcode, " (", retcode_desc, ")");

   // TRADE_RETCODE_DONE = 10009
   if(retcode == 10009)
      AckPositionDone(cmd_id, lease_token, retcode, retcode_desc);
   else
      AckPositionRejected(cmd_id, lease_token, retcode, retcode_desc,
                          "Command failed: " + retcode_desc);
}

//──────────────────────────────────────────────────────────────────────────
// Poll the backend for the next position command — Phase 2
//──────────────────────────────────────────────────────────────────────────
void PollForPositionCommand()
{
   if(g_poll_position_in_progress) return;
   g_poll_position_in_progress = true;

   string resp; int http_status;
   if(!HttpRequest("GET", "/mt5/ea/position-commands/next?lease_seconds=30", "", resp, http_status))
   { g_poll_position_in_progress = false; return; }

   string cmd_id = JsonStringField(resp, "id");
   if(cmd_id == "") { g_poll_position_in_progress = false; return; }

   string command_type       = JsonStringField(resp, "command_type");
   string account_type       = JsonStringField(resp, "account_type");
   string lease_token        = JsonStringField(resp, "lease_token");
   double position_ticket_d  = JsonNumberField(resp, "mt5_position_ticket");
   double volume_d           = JsonNumberField(resp, "volume");
   double new_sl             = JsonNumberField(resp, "new_stop_loss");
   double new_tp             = JsonNumberField(resp, "new_take_profit");

   if(position_ticket_d <= 0)
   {
      Print("TradeBridge: position command missing mt5_position_ticket.");
      g_poll_position_in_progress = false;
      return;
   }

   long position_ticket = (long)position_ticket_d;
   // Treat negative/null values (JsonNumberField returns -1 for null) as 0
   if(new_sl < 0) new_sl = 0;
   if(new_tp < 0) new_tp = 0;
   // volume -1 means null (full close); pass 0 to ExecutePositionCommand
   double volume = (volume_d > 0) ? volume_d : 0;

   Print("TradeBridge: position command id=", cmd_id,
         " type=", command_type, " ticket=", position_ticket,
         " volume=", volume, " sl=", new_sl, " tp=", new_tp);

   ExecutePositionCommand(cmd_id, command_type, position_ticket, volume,
                          new_sl, new_tp, account_type, lease_token);

   g_poll_position_in_progress = false;
}

//──────────────────────────────────────────────────────────────────────────
// OnTradeTransaction — detect fills of tracked pending orders (Phase 2)
//──────────────────────────────────────────────────────────────────────────
void OnTradeTransaction(const MqlTradeTransaction &trans,
                        const MqlTradeRequest     &request,
                        const MqlTradeResult      &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   long order_ticket = (long)trans.order;
   if(order_ticket <= 0) return;

   int count = ArraySize(g_placed_orders);
   for(int i = 0; i < count; i++)
   {
      if(g_placed_orders[i].mt5_ticket == order_ticket)
      {
         string oid  = g_placed_orders[i].order_id;
         string tok  = g_placed_orders[i].lease_token;
         long   deal = (long)trans.deal;
         double price = trans.price;
         double vol   = trans.volume;

         Print("TradeBridge: pending order filled via transaction. order_id=", oid,
               " ticket=", order_ticket, " deal=", deal,
               " price=", price, " volume=", vol);

         AckFilled(oid, tok, order_ticket, deal, price, vol, 0, "FILLED_BY_TRANSACTION");
         RemovePlacedOrder(order_ticket);
         return;
      }
   }
}

//──────────────────────────────────────────────────────────────────────────
// EA lifecycle
//──────────────────────────────────────────────────────────────────────────
int OnInit()
{
   if(StringLen(InpDeviceCredential) < 32)
   {
      Print("Set InpDeviceCredential to the paired device credential before starting.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(InpPollSeconds < 1 || InpPollSeconds > 60)
   {
      Print("InpPollSeconds must be between 1 and 60.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(InpAccountType != "demo" && InpAccountType != "real")
   {
      Print("InpAccountType must be 'demo' or 'real'.");
      return INIT_PARAMETERS_INCORRECT;
   }

   g_base_url = InpBackendBaseUrl;
   while(StringLen(g_base_url) > 0 &&
         StringSubstr(g_base_url, StringLen(g_base_url) - 1, 1) == "/")
      g_base_url = StringSubstr(g_base_url, 0, StringLen(g_base_url) - 1);

   ArrayResize(g_placed_orders, 0);
   EventSetTimer(InpPollSeconds);

   long account_mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   bool is_demo = (account_mode == 0) || (account_mode == 1);
   Print("TradeBridge Phase 1+2 v3.00 started. Account mode=", account_mode,
         " (", (is_demo ? "DEMO" : "REAL"), ").",
         " EA InpAccountType=", InpAccountType,
         " Backend=", g_base_url);
   Print("Add to WebRequest allow-list: ", g_base_url);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   // Market-selection commands, trade orders, and position commands
   // are polled on the same timer. Guard flags prevent re-entrant HTTP calls.
   PollForCommand();
   PollForTradeOrder();
   PollForPositionCommand();
}

void OnTick()
{
   // Deliberately unused. All polling is timer-driven.
}
