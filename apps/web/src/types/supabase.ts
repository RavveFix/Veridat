export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      api_usage: {
        Row: {
          company_id: string | null
          created_at: string | null
          daily_count: number
          daily_reset: string
          endpoint: string
          hourly_count: number
          hourly_reset: string
          id: string
          last_reset: string | null
          request_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          daily_count?: number
          daily_reset?: string
          endpoint: string
          hourly_count?: number
          hourly_reset?: string
          id?: string
          last_reset?: string | null
          request_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          daily_count?: number
          daily_reset?: string
          endpoint?: string
          hourly_count?: number
          hourly_reset?: string
          id?: string
          last_reset?: string | null
          request_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          company_id: string | null
          created_at: string | null
          id: string
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          address: string
          created_at: string
          id: string
          name: string
          org_number: string
          phone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string
          created_at?: string
          id: string
          name: string
          org_number?: string
          phone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          name?: string
          org_number?: string
          phone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      accounting_memories: {
        Row: {
          id: string
          user_id: string
          company_id: string
          entity_type: string
          entity_key: string | null
          label: string
          payload: Json
          source_type: string
          source_id: string | null
          source_reliability: number
          confidence: number
          confirmation_count: number
          rejection_count: number
          review_status: string
          fiscal_year: string | null
          period_start: string | null
          period_end: string | null
          valid_from: string | null
          valid_to: string | null
          last_used_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          company_id: string
          entity_type: string
          entity_key?: string | null
          label?: string
          payload?: Json
          source_type: string
          source_id?: string | null
          source_reliability?: number
          confidence?: number
          confirmation_count?: number
          rejection_count?: number
          review_status?: string
          fiscal_year?: string | null
          period_start?: string | null
          period_end?: string | null
          valid_from?: string | null
          valid_to?: string | null
          last_used_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          company_id?: string
          entity_type?: string
          entity_key?: string | null
          label?: string
          payload?: Json
          source_type?: string
          source_id?: string | null
          source_reliability?: number
          confidence?: number
          confirmation_count?: number
          rejection_count?: number
          review_status?: string
          fiscal_year?: string | null
          period_start?: string | null
          period_end?: string | null
          valid_from?: string | null
          valid_to?: string | null
          last_used_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      accounting_profiles: {
        Row: {
          bookkeeping_method: string
          company_form: string
          company_id: string
          created_at: string
          fiscal_year_start_month: number
          payroll_enabled: boolean
          updated_at: string
          user_id: string
          vat_periodicity: string
        }
        Insert: {
          bookkeeping_method?: string
          company_form?: string
          company_id: string
          created_at?: string
          fiscal_year_start_month?: number
          payroll_enabled?: boolean
          updated_at?: string
          user_id: string
          vat_periodicity?: string
        }
        Update: {
          bookkeeping_method?: string
          company_form?: string
          company_id?: string
          created_at?: string
          fiscal_year_start_month?: number
          payroll_enabled?: boolean
          updated_at?: string
          user_id?: string
          vat_periodicity?: string
        }
        Relationships: []
      }
      agi_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_id: string
          control_results: Json
          created_at: string
          id: string
          period: string
          source_type: string
          status: string
          totals: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          control_results?: Json
          created_at?: string
          id?: string
          period: string
          source_type?: string
          status?: string
          totals?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          control_results?: Json
          created_at?: string
          id?: string
          period?: string
          source_type?: string
          status?: string
          totals?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      auto_post_policies: {
        Row: {
          allow_with_active_rule_only: boolean
          company_id: string
          created_at: string
          enabled: boolean
          max_amount_sek: number
          min_confidence: number
          require_known_counterparty: boolean
          require_manual_for_deviating_vat: boolean
          require_manual_for_locked_period: boolean
          require_manual_for_new_supplier: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_with_active_rule_only?: boolean
          company_id: string
          created_at?: string
          enabled?: boolean
          max_amount_sek?: number
          min_confidence?: number
          require_known_counterparty?: boolean
          require_manual_for_deviating_vat?: boolean
          require_manual_for_locked_period?: boolean
          require_manual_for_new_supplier?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_with_active_rule_only?: boolean
          company_id?: string
          created_at?: string
          enabled?: boolean
          max_amount_sek?: number
          min_confidence?: number
          require_known_counterparty?: boolean
          require_manual_for_deviating_vat?: boolean
          require_manual_for_locked_period?: boolean
          require_manual_for_new_supplier?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bank_imports: {
        Row: {
          company_id: string
          created_at: string
          filename: string
          id: string
          idempotency_key: string | null
          imported_at: string
          mapping: Json
          row_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          filename?: string
          id: string
          idempotency_key?: string | null
          imported_at?: string
          mapping?: Json
          row_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          filename?: string
          id?: string
          idempotency_key?: string | null
          imported_at?: string
          mapping?: Json
          row_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          account: string | null
          ai_decision_id: string | null
          amount: number
          company_id: string
          counterparty: string | null
          created_at: string
          currency: string
          description: string
          fortnox_ref: Json
          id: string
          import_id: string | null
          match_status: string
          ocr: string | null
          raw: Json
          reference: string | null
          tx_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account?: string | null
          ai_decision_id?: string | null
          amount?: number
          company_id: string
          counterparty?: string | null
          created_at?: string
          currency?: string
          description?: string
          fortnox_ref?: Json
          id: string
          import_id?: string | null
          match_status?: string
          ocr?: string | null
          raw?: Json
          reference?: string | null
          tx_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account?: string | null
          ai_decision_id?: string | null
          amount?: number
          company_id?: string
          counterparty?: string | null
          created_at?: string
          currency?: string
          description?: string
          fortnox_ref?: Json
          id?: string
          import_id?: string | null
          match_status?: string
          ocr?: string | null
          raw?: Json
          reference?: string | null
          tx_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invoice_inbox_items: {
        Row: {
          ai_decision_id: string | null
          ai_extracted: boolean
          ai_raw_response: string
          ai_review_note: string
          bas_account: string
          bas_account_name: string
          company_id: string
          created_at: string
          currency: string
          due_date: string | null
          file_bucket: string
          file_name: string
          file_path: string
          file_url: string
          fortnox_balance: number | null
          fortnox_booked: boolean
          fortnox_given_number: number | null
          fortnox_supplier_number: string
          fortnox_sync_status: string
          id: string
          invoice_date: string | null
          invoice_number: string
          ocr_number: string
          source: string
          status: string
          supplier_name: string
          supplier_org_nr: string
          total_amount: number | null
          updated_at: string
          uploaded_at: string
          user_id: string
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          ai_decision_id?: string | null
          ai_extracted?: boolean
          ai_raw_response?: string
          ai_review_note?: string
          bas_account?: string
          bas_account_name?: string
          company_id: string
          created_at?: string
          currency?: string
          due_date?: string | null
          file_bucket?: string
          file_name?: string
          file_path?: string
          file_url?: string
          fortnox_balance?: number | null
          fortnox_booked?: boolean
          fortnox_given_number?: number | null
          fortnox_supplier_number?: string
          fortnox_sync_status?: string
          id: string
          invoice_date?: string | null
          invoice_number?: string
          ocr_number?: string
          source?: string
          status?: string
          supplier_name?: string
          supplier_org_nr?: string
          total_amount?: number | null
          updated_at?: string
          uploaded_at?: string
          user_id: string
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          ai_decision_id?: string | null
          ai_extracted?: boolean
          ai_raw_response?: string
          ai_review_note?: string
          bas_account?: string
          bas_account_name?: string
          company_id?: string
          created_at?: string
          currency?: string
          due_date?: string | null
          file_bucket?: string
          file_name?: string
          file_path?: string
          file_url?: string
          fortnox_balance?: number | null
          fortnox_booked?: boolean
          fortnox_given_number?: number | null
          fortnox_supplier_number?: string
          fortnox_sync_status?: string
          id?: string
          invoice_date?: string | null
          invoice_number?: string
          ocr_number?: string
          source?: string
          status?: string
          supplier_name?: string
          supplier_org_nr?: string
          total_amount?: number | null
          updated_at?: string
          uploaded_at?: string
          user_id?: string
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      invoice_inbox_events: {
        Row: {
          ai_decision_id: string | null
          company_id: string
          created_at: string
          event_type: string
          fingerprint: string | null
          id: string
          idempotency_key: string | null
          item_id: string
          new_status: string | null
          payload: Json
          previous_status: string | null
          user_id: string
        }
        Insert: {
          ai_decision_id?: string | null
          company_id: string
          created_at?: string
          event_type: string
          fingerprint?: string | null
          id?: string
          idempotency_key?: string | null
          item_id: string
          new_status?: string | null
          payload?: Json
          previous_status?: string | null
          user_id: string
        }
        Update: {
          ai_decision_id?: string | null
          company_id?: string
          created_at?: string
          event_type?: string
          fingerprint?: string | null
          id?: string
          idempotency_key?: string | null
          item_id?: string
          new_status?: string | null
          payload?: Json
          previous_status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      reconciliation_periods: {
        Row: {
          company_id: string
          created_at: string
          id: string
          locked_at: string | null
          notes: string
          period: string
          reconciled_at: string | null
          reconciled_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          locked_at?: string | null
          notes?: string
          period: string
          reconciled_at?: string | null
          reconciled_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          locked_at?: string | null
          notes?: string
          period?: string
          reconciled_at?: string | null
          reconciled_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      regulatory_rules: {
        Row: {
          company_form: string
          created_at: string
          domain: string
          effective_from: string
          effective_to: string | null
          id: string
          last_verified_at: string | null
          legal_status: string
          payload: Json
          rule_key: string
          source_urls: string[]
          updated_at: string
        }
        Insert: {
          company_form?: string
          created_at?: string
          domain: string
          effective_from: string
          effective_to?: string | null
          id?: string
          last_verified_at?: string | null
          legal_status?: string
          payload?: Json
          rule_key: string
          source_urls?: string[]
          updated_at?: string
        }
        Update: {
          company_form?: string
          created_at?: string
          domain?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          last_verified_at?: string | null
          legal_status?: string
          payload?: Json
          rule_key?: string
          source_urls?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      files: {
        Row: {
          company_id: string | null
          file_size: number
          filename: string
          id: string
          mime_type: string
          storage_path: string
          uploaded_at: string | null
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          file_size: number
          filename: string
          id?: string
          mime_type: string
          storage_path: string
          uploaded_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          file_size?: number
          filename?: string
          id?: string
          mime_type?: string
          storage_path?: string
          uploaded_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      fortnox_tokens: {
        Row: {
          access_token: string
          company_id: string
          created_at: string | null
          expires_at: string | null
          id: string
          refresh_token: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          access_token: string
          company_id: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          refresh_token: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_token?: string
          company_id?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          refresh_token?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      legal_acceptances: {
        Row: {
          accepted_at: string
          accepted_from: string
          company_id: string | null
          company_org_number: string | null
          created_at: string
          doc_type: string
          dpa_authorized: boolean
          id: string
          user_agent: string | null
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          accepted_from?: string
          company_id?: string | null
          company_org_number?: string | null
          created_at?: string
          doc_type: string
          dpa_authorized?: boolean
          id?: string
          user_agent?: string | null
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          accepted_from?: string
          company_id?: string | null
          company_org_number?: string | null
          created_at?: string
          doc_type?: string
          dpa_authorized?: boolean
          id?: string
          user_agent?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          file_name: string | null
          file_url: string | null
          id: string
          metadata: Json | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          file_name?: string | null
          file_url?: string | null
          id?: string
          metadata?: Json | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          file_name?: string | null
          file_url?: string | null
          id?: string
          metadata?: Json | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          billing_provider: string
          billing_status: string
          consent_email_sent: boolean | null
          consent_email_sent_at: string | null
          external_subscription_id: string | null
          full_name: string | null
          grace_until: string | null
          has_accepted_terms: boolean | null
          id: string
          invoice_due_date: string | null
          invoice_id: string | null
          is_admin: boolean
          paid_at: string | null
          plan: string
          period_end: string | null
          terms_accepted_at: string | null
          terms_version: string | null
          trial_end: string | null
          updated_at: string | null
          username: string | null
          website: string | null
        }
        Insert: {
          avatar_url?: string | null
          billing_provider?: string
          billing_status?: string
          consent_email_sent?: boolean | null
          consent_email_sent_at?: string | null
          external_subscription_id?: string | null
          full_name?: string | null
          grace_until?: string | null
          has_accepted_terms?: boolean | null
          id: string
          invoice_due_date?: string | null
          invoice_id?: string | null
          is_admin?: boolean
          paid_at?: string | null
          plan?: string
          period_end?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          trial_end?: string | null
          updated_at?: string | null
          username?: string | null
          website?: string | null
        }
        Update: {
          avatar_url?: string | null
          billing_provider?: string
          billing_status?: string
          consent_email_sent?: boolean | null
          consent_email_sent_at?: string | null
          external_subscription_id?: string | null
          full_name?: string | null
          grace_until?: string | null
          has_accepted_terms?: boolean | null
          id?: string
          invoice_due_date?: string | null
          invoice_id?: string | null
          is_admin?: boolean
          paid_at?: string | null
          plan?: string
          period_end?: string | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          trial_end?: string | null
          updated_at?: string | null
          username?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      terms_versions: {
        Row: {
          id: string
          version: string
          effective_date: string
          terms_url: string | null
          privacy_url: string | null
          change_summary: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          version: string
          effective_date?: string
          terms_url?: string | null
          privacy_url?: string | null
          change_summary?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          version?: string
          effective_date?: string
          terms_url?: string | null
          privacy_url?: string | null
          change_summary?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_api_usage: { Args: never; Returns: undefined }
      get_or_create_conversation: {
        Args: { p_company_id?: string; p_user_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
  | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
  ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
    DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] &
    DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
  ? R
  : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I
  }
  ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I
  }
  ? I
  : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U
  }
  ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U
  }
  ? U
  : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
  | keyof DefaultSchema["Enums"]
  | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
  : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
  | keyof DefaultSchema["CompositeTypes"]
  | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
  : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
