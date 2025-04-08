// components/EnvelopeItem.tsx
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { formatBalances } from '@/lib/currency-utils'; // [cite: 295]
import { Trash2, Edit, ArrowRightLeft } from 'lucide-react';

// Updated Envelope interface (matching schema better)
export interface Envelope {
  id: string;
  name: string;
  balances: { [currency: string]: number }; // [cite: 283]
  isDefault?: boolean; // [cite: 283]
  // Add other potential fields if needed from schema
}

// Props for the EnvelopeItem component
interface EnvelopeItemProps {
  envelope: Envelope;
  isLastEnvelope: boolean; // New prop to indicate if it's the only one
  onEdit: (envelopeId: string) => void;
  onTransfer: (sourceEnvelopeId: string) => void;
  onDelete: (envelopeId: string) => void;
}

const EnvelopeItem: React.FC<EnvelopeItemProps> = ({
  envelope,
  isLastEnvelope, // Use this prop
  onEdit,
  onTransfer,
  onDelete,
}) => {
  // Delete button is disabled only if it's the last envelope [cite: 344]
  const isDeletable = !isLastEnvelope;

  return (
    <Card className="mb-4 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold flex items-center">
          {envelope.name}
          {envelope.isDefault && ( // Display (Default) if isDefault is true [cite: 283]
            <span className="ml-2 text-xs font-normal text-muted-foreground bg-accent px-1.5 py-0.5 rounded">
              Default
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        {/* Display formatted balances using the utility function */}
        <p className="text-sm text-muted-foreground">
          Balance: <span className="font-medium text-foreground">{formatBalances(envelope.balances) /* [cite: 295] */}</span>
        </p>
      </CardContent>
      <CardFooter className="flex justify-end space-x-2">
        {/* Edit Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(envelope.id)}
          aria-label={`Edit ${envelope.name} envelope`}
        >
          <Edit className="h-4 w-4 mr-1" /> Edit
        </Button>

        {/* Transfer Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onTransfer(envelope.id)}
          aria-label={`Transfer funds from ${envelope.name} envelope`}
        >
          <ArrowRightLeft className="h-4 w-4 mr-1" /> Transfer
        </Button>

        {/* Delete Button - Conditionally disabled */}
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDelete(envelope.id)}
          disabled={!isDeletable} // Disable based on isLastEnvelope [cite: 344]
          aria-label={`Delete ${envelope.name} envelope`}
        >
          <Trash2 className="h-4 w-4 mr-1" /> Delete
        </Button>
      </CardFooter>
    </Card>
  );
};

export default EnvelopeItem;