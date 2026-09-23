import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function DialogFixture() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button">Delete transaction</button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Remove PETR4 transaction?</DialogTitle>
          <DialogDescription>
            This permanently removes 10 shares traded on 2025-01-15.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button">Cancel</button>
          </DialogClose>
          <button type="button">Remove transaction</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TableFixture() {
  return (
    <Table>
      <TableCaption>Current portfolio positions</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Ticker</TableHead>
          <TableHead scope="col">Quantity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>PETR4</TableCell>
          <TableCell>10</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

export function MenuFixture() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button">Transaction actions</button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Edit transaction</DropdownMenuItem>
        <DropdownMenuItem variant="destructive">
          Delete transaction
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
