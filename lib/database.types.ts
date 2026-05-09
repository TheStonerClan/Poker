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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      blind_structures: {
        Row: {
          created_at: string
          id: string
          levels: Json
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          levels: Json
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          levels?: Json
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      color_up_requests: {
        Row: {
          created_at: string
          exchange_for_chips: Json
          id: string
          player_id: string
          processed_at: string | null
          processed_by: string | null
          session_id: string
          status: string
          submitted_chips: Json
          tournament_id: string
        }
        Insert: {
          created_at?: string
          exchange_for_chips: Json
          id?: string
          player_id: string
          processed_at?: string | null
          processed_by?: string | null
          session_id: string
          status?: string
          submitted_chips: Json
          tournament_id: string
        }
        Update: {
          created_at?: string
          exchange_for_chips?: Json
          id?: string
          player_id?: string
          processed_at?: string | null
          processed_by?: string | null
          session_id?: string
          status?: string
          submitted_chips?: Json
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "color_up_requests_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "color_up_requests_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          signal_handle: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          signal_handle?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          signal_handle?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      prize_distributions: {
        Row: {
          amount: number
          created_at: string
          id: string
          is_chopped: boolean
          paid_at: string | null
          player_id: string | null
          position: number
          tournament_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          is_chopped?: boolean
          paid_at?: string | null
          player_id?: string | null
          position: number
          tournament_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          is_chopped?: boolean
          paid_at?: string | null
          player_id?: string | null
          position?: number
          tournament_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prize_distributions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prize_distributions_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          original_date: string
          overridden_date: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          original_date: string
          overridden_date?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          original_date?: string
          overridden_date?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_overrides_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "tournament_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_events: {
        Row: {
          created_at: string
          id: string
          payload: Json
          tournament_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          tournament_id: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          tournament_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_events_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_players: {
        Row: {
          addons_used: number
          busted_at_level: number | null
          busted_at_time: string | null
          buyback_used: boolean
          buyback_used_as: string | null
          buyback_used_at_level: number | null
          buyback_used_at_time: string | null
          claimed_at: string | null
          claimed_session_id: string | null
          created_at: string
          current_chips: number
          finishing_position: number | null
          id: string
          payout_amount: number | null
          player_id: string
          rebuys_used: number
          seat_number: number | null
          table_number: number | null
          tournament_id: string
          updated_at: string
        }
        Insert: {
          addons_used?: number
          busted_at_level?: number | null
          busted_at_time?: string | null
          buyback_used?: boolean
          buyback_used_as?: string | null
          buyback_used_at_level?: number | null
          buyback_used_at_time?: string | null
          claimed_at?: string | null
          claimed_session_id?: string | null
          created_at?: string
          current_chips?: number
          finishing_position?: number | null
          id?: string
          payout_amount?: number | null
          player_id: string
          rebuys_used?: number
          seat_number?: number | null
          table_number?: number | null
          tournament_id: string
          updated_at?: string
        }
        Update: {
          addons_used?: number
          busted_at_level?: number | null
          busted_at_time?: string | null
          buyback_used?: boolean
          buyback_used_as?: string | null
          buyback_used_at_level?: number | null
          buyback_used_at_time?: string | null
          claimed_at?: string | null
          claimed_session_id?: string | null
          created_at?: string
          current_chips?: number
          finishing_position?: number | null
          id?: string
          payout_amount?: number | null
          player_id?: string
          rebuys_used?: number
          seat_number?: number | null
          table_number?: number | null
          tournament_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tournament_players_tournament_id_fkey"
            columns: ["tournament_id"]
            isOneToOne: false
            referencedRelation: "tournaments"
            referencedColumns: ["id"]
          },
        ]
      }
      tournament_templates: {
        Row: {
          ante_mode: string
          blind_structure_id: string
          buy_in: number
          buyback_config: Json
          chip_denominations: Json
          created_at: string
          currency: string
          id: string
          location: string | null
          max_rebuys: number
          name: string
          prize_rules: Json
          rebuy_chips: number
          rebuy_price: number
          recurrence_rule: string | null
          rounding_mode: Json
          side_pots: Json
          starting_stack: number
          starting_stack_composition: Json
          updated_at: string
        }
        Insert: {
          ante_mode?: string
          blind_structure_id: string
          buy_in: number
          buyback_config?: Json
          chip_denominations?: Json
          created_at?: string
          currency?: string
          id?: string
          location?: string | null
          max_rebuys?: number
          name: string
          prize_rules: Json
          rebuy_chips?: number
          rebuy_price?: number
          recurrence_rule?: string | null
          rounding_mode?: Json
          side_pots?: Json
          starting_stack: number
          starting_stack_composition?: Json
          updated_at?: string
        }
        Update: {
          ante_mode?: string
          blind_structure_id?: string
          buy_in?: number
          buyback_config?: Json
          chip_denominations?: Json
          created_at?: string
          currency?: string
          id?: string
          location?: string | null
          max_rebuys?: number
          name?: string
          prize_rules?: Json
          rebuy_chips?: number
          rebuy_price?: number
          recurrence_rule?: string | null
          rounding_mode?: Json
          side_pots?: Json
          starting_stack?: number
          starting_stack_composition?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournament_templates_blind_structure_id_fkey"
            columns: ["blind_structure_id"]
            isOneToOne: false
            referencedRelation: "blind_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      tournaments: {
        Row: {
          accumulated_pause_ms: number
          ante_mode_snapshot: string
          blind_structure_snapshot: Json
          buy_in_snapshot: number
          buyback_config_snapshot: Json
          chip_denominations_snapshot: Json
          created_at: string
          current_level: number
          finished_at: string | null
          id: string
          level_paused_at: string | null
          level_started_at: string | null
          max_rebuys_snapshot: number
          max_seats_per_table: number | null
          num_tables: number | null
          prize_rules_snapshot: Json
          rebuy_chips_snapshot: number
          rebuy_price_snapshot: number
          rounding_mode_snapshot: Json
          scheduled_at: string | null
          side_pots_snapshot: Json
          started_at: string | null
          starting_stack_composition_snapshot: Json
          starting_stack_snapshot: number
          status: string
          template_id: string
          updated_at: string
        }
        Insert: {
          accumulated_pause_ms?: number
          ante_mode_snapshot: string
          blind_structure_snapshot: Json
          buy_in_snapshot: number
          buyback_config_snapshot: Json
          chip_denominations_snapshot: Json
          created_at?: string
          current_level?: number
          finished_at?: string | null
          id?: string
          level_paused_at?: string | null
          level_started_at?: string | null
          max_rebuys_snapshot: number
          max_seats_per_table?: number | null
          num_tables?: number | null
          prize_rules_snapshot: Json
          rebuy_chips_snapshot: number
          rebuy_price_snapshot: number
          rounding_mode_snapshot: Json
          scheduled_at?: string | null
          side_pots_snapshot: Json
          started_at?: string | null
          starting_stack_composition_snapshot: Json
          starting_stack_snapshot: number
          status?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          accumulated_pause_ms?: number
          ante_mode_snapshot?: string
          blind_structure_snapshot?: Json
          buy_in_snapshot?: number
          buyback_config_snapshot?: Json
          chip_denominations_snapshot?: Json
          created_at?: string
          current_level?: number
          finished_at?: string | null
          id?: string
          level_paused_at?: string | null
          level_started_at?: string | null
          max_rebuys_snapshot?: number
          max_seats_per_table?: number | null
          num_tables?: number | null
          prize_rules_snapshot?: Json
          rebuy_chips_snapshot?: number
          rebuy_price_snapshot?: number
          rounding_mode_snapshot?: Json
          scheduled_at?: string | null
          side_pots_snapshot?: Json
          started_at?: string | null
          starting_stack_composition_snapshot?: Json
          starting_stack_snapshot?: number
          status?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tournaments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "tournament_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
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
