int main(void)
{
    __asm {
        lda ($fb),x
    }
    return 0;
}
