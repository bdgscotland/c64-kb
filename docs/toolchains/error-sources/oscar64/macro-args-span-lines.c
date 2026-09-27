#define CHECK(c) do { if (!(c)) fail = 1; } while (0)
char fail;
int main(void)
{
    char a = 1, b = 2;
    CHECK(a == 1 &&
          b == 2);
    return fail;
}
