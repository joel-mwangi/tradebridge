//+------------------------------------------------------------------+
//| TradeBridgeMarketBridge.mq5                                      |
//| Market selection only. This EA does not place or manage orders.  |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "Polls TradeBridge for market-selection commands and acknowledges them."

input string InpBackendBaseUrl = "https://ai-tradingbridge.vercel.app";
input string InpDeviceCredential = ""; // Paste the one-time credential returned by /mt5/pair.
input string InpSymbolMappings = "frxEURUSD=EURUSD"; // Exact provider=broker pairs, separated by semicolons.
input int    InpPollSeconds = 3;
input int    InpHttpTimeoutMs = 8000;

string g_base_url;
bool   g_poll_in_progress = false;

// Convert a string to UTF-8 request bytes, excluding the terminal NUL.
void StringToUtf8Bytes(const string value, char &bytes[])
{
   int count = StringToCharArray(value, bytes, 0, WHOLE_ARRAY, CP_UTF8);
   if(count > 0)
      ArrayResize(bytes, count - 1);
}

string Utf8BytesToString(char &bytes[])
{
   return CharArrayToString(bytes, 0, WHOLE_ARRAY, CP_UTF8);
}

string JsonEscape(const string value)
{
   string out = "";
   for(int i = 0; i < StringLen(value); i++)
   {
      ushort c = StringGetCharacter(value, i);
      if(c == 34)       out += "\\\"";
      else if(c == 92)  out += "\\\\";
      else if(c == 10)  out += "\\n";
      else if(c == 13)  out += "\\r";
      else if(c == 9)   out += "\\t";
      else              out += ShortToString(c);
   }
   return out;
}

// Extracts a simple JSON string field. The fields used by this API are strings
// (UUIDs, symbols, tokens); escaped quote/backslash handling is included.
string JsonStringField(const string json, const string field)
{
   string needle = "\"" + field + "\"";
   int key_pos = StringFind(json, needle);
   if(key_pos < 0) return "";

   int colon_pos = StringFind(json, ":", key_pos + StringLen(needle));
   if(colon_pos < 0) return "";
   int quote_pos = StringFind(json, "\"", colon_pos + 1);
   if(quote_pos < 0) return "";

   string value = "";
   bool escaped = false;
   for(int i = quote_pos + 1; i < StringLen(json); i++)
   {
      ushort c = StringGetCharacter(json, i);
      if(escaped)
      {
         if(c == 110) value += "\n";
         else if(c == 114) value += "\r";
         else if(c == 116) value += "\t";
         else value += ShortToString(c);
         escaped = false;
         continue;
      }
      if(c == 92) { escaped = true; continue; }
      if(c == 34) return value;
      value += ShortToString(c);
   }
   return "";
}

bool HttpRequest(const string method, const string path, const string body,
                 string &response_text, int &http_status)
{
   char request_bytes[];
   char response_bytes[];
   string response_headers = "";
   string headers = "Authorization: Bearer " + InpDeviceCredential + "\r\n";
   headers += "Content-Type: application/json\r\n";
   headers += "Accept: application/json\r\n";

   StringToUtf8Bytes(body, request_bytes);
   ResetLastError();
   http_status = WebRequest(method, g_base_url + path, headers,
                            InpHttpTimeoutMs, request_bytes,
                            response_bytes, response_headers);
   if(http_status == -1)
   {
      Print("TradeBridge HTTP request failed. MQL5 error=", GetLastError(),
            ". Check terminal WebRequest allow-list and network connectivity.");
      response_text = "";
      return false;
   }

   response_text = Utf8BytesToString(response_bytes);
   if(http_status < 200 || http_status >= 300)
   {
      Print("TradeBridge returned HTTP ", http_status, " for ", method, " ", path,
            ". Response: ", response_text);
      return false;
   }
   return true;
}

bool ResolveBrokerSymbol(const string provider_symbol, string &broker_symbol)
{
   string mappings[];
   int count = StringSplit(InpSymbolMappings, ';', mappings);
   for(int i = 0; i < count; i++)
   {
      string pair = mappings[i];
      StringTrimLeft(pair);
      StringTrimRight(pair);
      int equals_pos = StringFind(pair, "=");
      if(equals_pos <= 0) continue;

      string provider = StringSubstr(pair, 0, equals_pos);
      string broker = StringSubstr(pair, equals_pos + 1);
      StringTrimLeft(provider);
      StringTrimRight(provider);
      StringTrimLeft(broker);
      StringTrimRight(broker);

      if(provider == provider_symbol && broker != "")
      {
         broker_symbol = broker;
         return true;
      }
   }
   return false;
}

bool SelectBrokerMarket(const string broker_symbol, string &result_code, string &result_message)
{
   if(broker_symbol == "")
   {
      result_code = "SYMBOL_MAPPING_MISSING";
      result_message = "No explicit provider-to-broker symbol mapping is configured.";
      return false;
   }

   if(!SymbolExist(broker_symbol, NULL))
   {
      result_code = "BROKER_SYMBOL_NOT_FOUND";
      result_message = "Mapped broker symbol does not exist in this terminal: " + broker_symbol;
      return false;
   }

   ResetLastError();
   if(!SymbolSelect(broker_symbol, true))
   {
      result_code = "SYMBOL_SELECT_FAILED";
      result_message = "MT5 could not select broker symbol " + broker_symbol
                       + "; error=" + IntegerToString(GetLastError());
      return false;
   }

   result_code = "MARKET_SELECTED";
   result_message = "Selected broker symbol " + broker_symbol;
   Print("TradeBridge market selected: ", broker_symbol);
   return true;
}

bool AcknowledgeCommand(const string command_id, const string lease_token,
                        const bool accepted, const string result_code,
                        const string result_message)
{
   string outcome = accepted ? "acknowledged" : "rejected";
   string body = "{\"lease_token\":\"" + JsonEscape(lease_token)
                 + "\",\"outcome\":\"" + outcome
                 + "\",\"result_code\":\"" + JsonEscape(result_code)
                 + "\",\"result_message\":\"" + JsonEscape(result_message) + "\"}";
   string response_text;
   int http_status;
   string path = "/mt5/ea/commands/" + command_id + "/ack";
   if(!HttpRequest("POST", path, body, response_text, http_status))
   {
      Print("Could not acknowledge MT5 command ", command_id,
            ". The command may be retried after its lease expires.");
      return false;
   }

   Print("TradeBridge command ", command_id, " acknowledged as ", outcome,
         " (", result_code, ").");
   return true;
}

void PollForCommand()
{
   if(g_poll_in_progress) return;
   g_poll_in_progress = true;

   string response_text;
   int http_status;
   if(!HttpRequest("GET", "/mt5/ea/commands/next?lease_seconds=20", "",
                   response_text, http_status))
   {
      g_poll_in_progress = false;
      return;
   }

   string command_id = JsonStringField(response_text, "id");
   if(command_id == "")
   {
      // Normal idle response: {"command": null}
      g_poll_in_progress = false;
      return;
   }

   string provider_symbol = JsonStringField(response_text, "provider_symbol");
   string lease_token = JsonStringField(response_text, "lease_token");
   if(provider_symbol == "" || lease_token == "")
   {
      Print("Malformed command response; missing provider_symbol or lease_token.");
      g_poll_in_progress = false;
      return;
   }

   string broker_symbol = "";
   string result_code = "";
   string result_message = "";
   bool mapped = ResolveBrokerSymbol(provider_symbol, broker_symbol);
   bool selected = false;

   if(!mapped)
   {
      result_code = "SYMBOL_MAPPING_MISSING";
      result_message = "No explicit mapping configured for provider symbol " + provider_symbol;
   }
   else
   {
      selected = SelectBrokerMarket(broker_symbol, result_code, result_message);
   }

   AcknowledgeCommand(command_id, lease_token, selected, result_code, result_message);
   g_poll_in_progress = false;
}

int OnInit()
{
   if(StringLen(InpDeviceCredential) < 32)
   {
      Print("Set InpDeviceCredential to the paired device credential before starting the EA.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(InpPollSeconds < 1 || InpPollSeconds > 60)
   {
      Print("InpPollSeconds must be between 1 and 60.");
      return INIT_PARAMETERS_INCORRECT;
   }

   g_base_url = InpBackendBaseUrl;
   while(StringLen(g_base_url) > 0 &&
         StringSubstr(g_base_url, StringLen(g_base_url) - 1, 1) == "/")
      g_base_url = StringSubstr(g_base_url, 0, StringLen(g_base_url) - 1);

   EventSetTimer(InpPollSeconds);
   Print("TradeBridge MT5 market-selection bridge started. No order execution is implemented.");
   Print("Confirm this URL is allowed in MT5: ", g_base_url);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   PollForCommand();
}

void OnTick()
{
   // Deliberately unused. Market commands are polled by timer, not by tick.
}
